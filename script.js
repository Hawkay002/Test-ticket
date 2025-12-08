import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, addDoc, onSnapshot, getDocs, query, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ==========================================
// FIREBASE CONFIGURATION
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyBYzmAZQ8sKHjXgVh_t-vbtYN_gRzBstw8",
    authDomain: "ticket-backend-5ee83.firebaseapp.com",
    projectId: "ticket-backend-5ee83",
    storageBucket: "ticket-backend-5ee83.firebasestorage.app",
    messagingSenderId: "370130815796",
    appId: "1:370130815796:web:33df8249fcc68ddc0f7361",
    measurementId: "G-CED9W20PBK"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const APP_COLLECTION_ROOT = 'ticket_events_data';

let currentUser = null;
let ticketsUnsubscribe = null;
let settingsUnsubscribe = null;
let securityUnsubscribe = null;
let autoCheckInterval = null;

// --- SECURITY STATE ---
// globalPassword comes from DB (Synced across devices)
let globalPassword = ""; 
// localLockState comes from LocalStorage (Device specific)
let localLockState = {
    isLocked: false,
    lockedTabs: []
};

// --- STATE MANAGEMENT FOR SELECTIONS ---
let selectedTicketIds = new Set(); 

// --- BACKGROUND STARS LOGIC ---
function createStars() {
    const container = document.getElementById('star-container');
    const numberOfStars = 100;
    
    for (let i = 0; i < numberOfStars; i++) {
        const star = document.createElement('div');
        star.classList.add('star');
        const size = Math.random() * 3 + 1;
        star.style.width = `${size}px`;
        star.style.height = `${size}px`;
        star.style.left = `${Math.random() * 100}vw`;
        star.style.top = `${Math.random() * 100}vh`;
        star.style.animationDuration = `${Math.random() * 2 + 1}s`;
        container.appendChild(star);
    }
}
createStars(); 

// --- SEARCH & FILTER STATE ---
let searchTerm = '';
let currentFilter = 'all'; 
let currentGenderFilter = 'all';
let currentSort = 'newest';
let currentFilteredTickets = []; 

// --- TOAST NOTIFICATIONS ---
function showToast(title, msg) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <div class="toast-title">${title}</div>
        <div class="toast-msg">${msg}</div>
        <div class="toast-note">Tip: Check Configuration for settings.</div>
    `;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 400);
    }, 5000);
}

// --- DOM ELEMENTS ---
const loginOverlay = document.getElementById('login-overlay');
const loadingScreen = document.getElementById('loading-screen');
const appContent = document.getElementById('appContent');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const togglePassword = document.getElementById('togglePassword');
const loginButton = document.getElementById('loginButton');
const authError = document.getElementById('auth-error');
const userEmailDisplay = document.getElementById('userEmailDisplay');
const logoutBtn = document.getElementById('logoutBtn');

// Modal Elements
const confirmModal = document.getElementById('confirm-modal');
const deleteCountSpan = document.getElementById('delete-count');
const cancelDeleteBtn = document.getElementById('cancelDelete');
const confirmDeleteBtn = document.getElementById('confirmDelete');
let pendingDeleteIds = [];

// Lock Modal Elements
const unlockModal = document.getElementById('unlock-modal');
const unlockPasswordInput = document.getElementById('unlockPasswordInput');
const unlockError = document.getElementById('unlock-error');
const cancelUnlockBtn = document.getElementById('cancelUnlock');
const confirmUnlockBtn = document.getElementById('confirmUnlock');

// Ticket View Modal Elements
const ticketViewModal = document.getElementById('ticket-view-modal');
const closeTicketModal = document.getElementById('closeTicketModal');
const modalWhatsAppBtn = document.getElementById('modalWhatsAppBtn');

// Security Setting Elements
const lockPasswordInput = document.getElementById('lockSettingPassword');
const toggleLockPassword = document.getElementById('toggleLockPassword');
const lockSystemBtn = document.getElementById('lockSystemBtn');
const lockCheckboxes = document.querySelectorAll('.lock-checkbox');

// Export Modal Elements
const exportModal = document.getElementById('export-modal');
const exportFileName = document.getElementById('exportFileName');
const exportFormat = document.getElementById('exportFormat');
const cancelExportBtn = document.getElementById('cancelExport');
const confirmExportBtn = document.getElementById('confirmExport');
const exportTriggerBtn = document.getElementById('exportTriggerBtn');
const exportCountMsg = document.getElementById('export-count-msg');

// Search & Filter DOM
const searchInput = document.getElementById('searchGuestInput');
const filterSortBtn = document.getElementById('filterSortBtn');
const filterDropdown = document.getElementById('filterDropdown');

// Refresh Icon
const refreshStatusIndicator = document.getElementById('refreshStatusIndicator');

// --- PASSWORD TOGGLE LOGIC ---
if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', function () {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        this.classList.toggle('fa-eye');
        this.classList.toggle('fa-eye-slash');
    });
}

if (toggleLockPassword && lockPasswordInput) {
    toggleLockPassword.addEventListener('click', function () {
        const type = lockPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        lockPasswordInput.setAttribute('type', type);
        this.classList.toggle('fa-eye');
        this.classList.toggle('fa-eye-slash');
    });
}

// --- CONNECTION STATUS ---
function updateOnlineStatus() {
    const syncDot = document.querySelector('.sync-dot');
    if (!syncDot) return;

    if (navigator.onLine) {
        syncDot.classList.remove('offline');
    } else {
        syncDot.classList.add('offline');
        showToast('Connection Lost', 'You are currently offline.');
    }
}

window.addEventListener('online', () => {
    updateOnlineStatus();
    showToast('Back Online', 'Connection restored.');
    performSync(); 
});
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// --- REFRESH / SYNC LOGIC ---
async function performSync() {
    if(!currentUser) return;
    const icon = refreshStatusIndicator.querySelector('i');
    if(icon) {
        icon.classList.add('fa-spin');
        icon.style.color = 'var(--accent-secondary)'; 
    }
    const startTime = Date.now();
    try {
        const ticketsRef = collection(db, APP_COLLECTION_ROOT, currentUser.uid, 'tickets');
        const q = query(ticketsRef);
        const snapshot = await getDocs(q);
        bookedTickets = [];
        snapshot.forEach((doc) => {
            bookedTickets.push({ id: doc.id, ...doc.data() });
        });
        await checkAutoAbsent();
        renderBookedTickets();
    } catch (err) {
        console.error("Auto-sync error:", err);
    } finally {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 1000 - elapsed);
        setTimeout(() => {
            if(icon) {
                icon.classList.remove('fa-spin');
                icon.style.color = ''; 
            }
        }, remaining);
    }
}
refreshStatusIndicator.addEventListener('click', performSync);

// --- EXPORT FUNCTIONALITY ---
exportTriggerBtn.addEventListener('click', () => {
    const count = selectedTicketIds.size;
    if(count === 0) return; 
    exportCountMsg.textContent = `Ready to export ${count} item${count !== 1 ? 's' : ''}.`;
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '_');
    exportFileName.value = `guest_list_${today}`;
    exportModal.style.display = 'flex';
});

cancelExportBtn.addEventListener('click', () => {
    exportModal.style.display = 'none';
});

confirmExportBtn.addEventListener('click', () => {
    const filename = exportFileName.value || 'guest_list';
    const format = exportFormat.value;
    let listToExport = [];
    if (selectedTicketIds.size > 0) {
        listToExport = bookedTickets.filter(t => selectedTicketIds.has(t.id));
    } else {
        exportModal.style.display = 'none';
        return alert("No data selected to export.");
    }
    switch(format) {
        case 'csv': exportCSV(listToExport, filename); break;
        case 'xlsx': exportXLSX(listToExport, filename); break;
        case 'pdf': exportPDF(listToExport, filename); break;
        case 'txt': exportTXT(listToExport, filename); break;
        case 'json': exportJSON(listToExport, filename); break;
        case 'doc': exportDOC(listToExport, filename); break;
    }
    exportModal.style.display = 'none';
    showToast("Export Complete", `${listToExport.length} records saved as .${format}`);
});

function exportCSV(data, filename) {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Guest Name,Age,Gender,Phone,Status,Ticket ID,Entry Time\n";
    data.forEach(row => {
        const scannedTime = row.scannedAt ? new Date(row.scannedAt).toLocaleTimeString() : "";
        const cleanName = row.name.replace(/,/g, ""); 
        const rowStr = `${cleanName},${row.age},${row.gender},${row.phone},${row.status},${row.id},${scannedTime}`;
        csvContent += rowStr + "\n";
    });
    downloadFile(encodeURI(csvContent), `${filename}.csv`);
}

function exportXLSX(data, filename) {
    const worksheetData = data.map(row => ({
        "Guest Name": row.name,
        "Age": row.age,
        "Gender": row.gender,
        "Phone": row.phone,
        "Status": row.status,
        "Ticket ID": row.id,
        "Entry Time": row.scannedAt ? new Date(row.scannedAt).toLocaleTimeString() : ""
    }));
    const ws = XLSX.utils.json_to_sheet(worksheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Guests");
    XLSX.writeFile(wb, `${filename}.xlsx`);
}

function exportPDF(data, filename) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.text("Event Guest List", 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 26);
    const tableColumn = ["Name", "Age", "Gender", "Phone", "Status", "Entry Time"];
    const tableRows = [];
    data.forEach(row => {
        tableRows.push([
            row.name,
            row.age,
            row.gender,
            row.phone,
            row.status.toUpperCase(),
            row.scannedAt ? new Date(row.scannedAt).toLocaleTimeString() : "--"
        ]);
    });
    doc.autoTable({ head: [tableColumn], body: tableRows, startY: 32 });
    doc.save(`${filename}.pdf`);
}

function exportTXT(data, filename) {
    let content = `GUEST LIST EXPORT - ${new Date().toLocaleString()}\n\n`;
    data.forEach((row, i) => {
        content += `${i+1}. ${row.name.toUpperCase()} \n`;
        content += `   Details: ${row.age} / ${row.gender}\n`;
        content += `   Phone: ${row.phone}\n`;
        content += `   Status: ${row.status.toUpperCase()}\n`;
        if(row.scannedAt) content += `   Entry: ${new Date(row.scannedAt).toLocaleTimeString()}\n`;
        content += `   ID: ${row.id}\n`;
        content += "----------------------------------------\n";
    });
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    downloadFile(url, `${filename}.txt`);
}

function exportJSON(data, filename) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    downloadFile(url, `${filename}.json`);
}

function exportDOC(data, filename) {
    let htmlBody = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>Guest List</title></head><body>
        <h2>Guest List Export</h2>
        <table border="1" style="border-collapse: collapse; width: 100%;">
            <tr style="background: #eee;">
                <th>Name</th><th>Age/Gender</th><th>Phone</th><th>Status</th>
            </tr>
    `;
    data.forEach(row => {
        htmlBody += `<tr><td>${row.name}</td><td>${row.age} / ${row.gender}</td><td>${row.phone}</td><td>${row.status}</td></tr>`;
    });
    htmlBody += "</table></body></html>";
    const blob = new Blob(['\ufeff', htmlBody], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    downloadFile(url, `${filename}.doc`);
}

function downloadFile(uri, filename) {
    const link = document.createElement("a");
    link.href = uri;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- SEARCH & FILTER LISTENERS ---
searchInput.addEventListener('input', (e) => {
    searchTerm = e.target.value.toLowerCase().trim();
    renderBookedTickets();
});

filterSortBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    filterDropdown.classList.toggle('show');
});

window.addEventListener('click', () => {
    filterDropdown.classList.remove('show');
});

document.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = item.dataset.type;
        const val = item.dataset.val;
        document.querySelectorAll(`.dropdown-item[data-type="${type}"]`).forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');

        if(type === 'filter') currentFilter = val;
        if(type === 'filter-gender') currentGenderFilter = val;
        if(type === 'sort') currentSort = val;

        renderBookedTickets();
        filterDropdown.classList.remove('show');
    });
});

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        userEmailDisplay.textContent = user.email;
        loadingScreen.style.display = 'none';
        loginOverlay.style.display = 'none';
        appContent.style.display = 'block';
        setupRealtimeListeners(user.uid);
        
        // Initialize Local Security State
        loadLocalSecurityState(user.uid);
        applySecurityLocks();

        if(autoCheckInterval) clearInterval(autoCheckInterval);
        autoCheckInterval = setInterval(performSync, 15000);
    } else {
        currentUser = null;
        loadingScreen.style.display = 'none';
        loginOverlay.style.display = 'flex';
        appContent.style.display = 'none';
        if (ticketsUnsubscribe) ticketsUnsubscribe();
        if (settingsUnsubscribe) settingsUnsubscribe();
        if (securityUnsubscribe) securityUnsubscribe();
        if (autoCheckInterval) clearInterval(autoCheckInterval);
    }
});

loginButton.addEventListener('click', async () => {
    const email = emailInput.value;
    const password = passwordInput.value;
    authError.style.display = 'none';
    loginButton.textContent = "Verifying...";
    loginButton.disabled = true;

    if (!email || !password) {
        showError("Please enter email and password.");
        return;
    }

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        console.error("Login failed:", error);
        if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
            showError("Access Denied.");
        } else {
            showError(error.message);
        }
    } finally {
        loginButton.textContent = "Authenticate";
        loginButton.disabled = false;
    }
});

logoutBtn.addEventListener('click', () => {
    signOut(auth);
});

function showError(msg) {
    authError.textContent = msg;
    authError.style.display = 'block';
    loginButton.textContent = "Authenticate";
    loginButton.disabled = false;
}

let bookedTickets = [];
let eventSettings = { name: '', place: '', deadline: '' };

function setupRealtimeListeners(userId) {
    const ticketsRef = collection(db, APP_COLLECTION_ROOT, userId, 'tickets');
    const q = query(ticketsRef);
    
    ticketsUnsubscribe = onSnapshot(q, (snapshot) => {
        bookedTickets = [];
        snapshot.forEach((doc) => {
            bookedTickets.push({ id: doc.id, ...doc.data() });
        });
        renderBookedTickets();
        checkAutoAbsent();
    });

    const settingsRef = doc(db, APP_COLLECTION_ROOT, userId, 'settings', 'config');
    settingsUnsubscribe = onSnapshot(settingsRef, (docSnap) => {
        if (docSnap.exists()) {
            eventSettings = docSnap.data();
            updateSettingsDisplay();
            checkAutoAbsent();
        } else {
            eventSettings = { name: '', place: '', deadline: '' };
            updateSettingsDisplay();
        }
    });

    // --- SECURITY LISTENER (Global Password Only) ---
    const securityRef = doc(db, APP_COLLECTION_ROOT, userId, 'settings', 'security');
    securityUnsubscribe = onSnapshot(securityRef, (docSnap) => {
        if (docSnap.exists()) {
            // Only sync the password from DB
            globalPassword = docSnap.data().password || "";
        } else {
            globalPassword = "";
        }
    });
}

// --- LOCAL SECURITY STORAGE ---
function loadLocalSecurityState(userId) {
    const stored = localStorage.getItem(`ticketApp_lockState_${userId}`);
    if (stored) {
        localLockState = JSON.parse(stored);
    } else {
        localLockState = { isLocked: false, lockedTabs: [] };
    }
}

function saveLocalSecurityState() {
    if(currentUser) {
        localStorage.setItem(`ticketApp_lockState_${currentUser.uid}`, JSON.stringify(localLockState));
    }
}

function applySecurityLocks() {
    const { isLocked, lockedTabs } = localLockState;
    const allNavs = document.querySelectorAll('.nav-btn');

    // Reset visual state
    allNavs.forEach(btn => {
        btn.classList.remove('locked');
    });

    if (isLocked) {
        // Mark Config as locked visually
        document.querySelector('[data-tab="settings"]').classList.add('locked');
        
        // Mark selected tabs as locked visually
        lockedTabs.forEach(tabName => {
            const btn = document.querySelector(`[data-tab="${tabName}"]`);
            if(btn) btn.classList.add('locked');
        });

        // Update Lock Controls UI
        lockSystemBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Locked';
        lockSystemBtn.classList.add('active'); 
        
        // Fill checkboxes based on state & disable them
        lockCheckboxes.forEach(cb => {
            cb.checked = lockedTabs.includes(cb.value);
            cb.disabled = true;
        });
        lockPasswordInput.disabled = true;
        lockPasswordInput.value = ''; // Hide password
        lockSystemBtn.disabled = true;
    } else {
        // Unlocked State
        lockCheckboxes.forEach(cb => {
            cb.disabled = false;
        });
        lockPasswordInput.disabled = false;
        lockSystemBtn.disabled = false;
        lockSystemBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Lock Tabs';
    }
}

// --- LOCK ACTION ---
lockSystemBtn.addEventListener('click', async () => {
    if(!currentUser) return;
    
    const inputPassword = lockPasswordInput.value;
    if(!inputPassword) {
        alert("Please set a password to lock the system.");
        return;
    }

    const selectedTabs = [];
    lockCheckboxes.forEach(cb => {
        if(cb.checked) selectedTabs.push(cb.value);
    });

    // 1. Check against Global Password (Prevent Overwrite)
    if (globalPassword && globalPassword !== inputPassword) {
        showToast("Access Denied", "Incorrect Master Password. You cannot overwrite the existing global password.");
        playError();
        lockPasswordInput.classList.add('shake');
        setTimeout(() => lockPasswordInput.classList.remove('shake'), 500);
        return;
    }

    try {
        // 2. Only Save to DB if NO global password exists (First time setup)
        if (!globalPassword) {
            await setDoc(doc(db, APP_COLLECTION_ROOT, currentUser.uid, 'settings', 'security'), {
                password: inputPassword
            }, { merge: true });
            
            // Immediately update local reference to avoid race condition in same session
            globalPassword = inputPassword;
            showToast("Setup Complete", "Global Master Password set.");
        }
        
        // 3. Save Lock State Locally (To LocalStorage)
        localLockState = {
            isLocked: true,
            lockedTabs: selectedTabs
        };
        saveLocalSecurityState();

        // 4. Apply UI changes immediately
        applySecurityLocks();
        
        // Force navigate away from settings to a safe tab
        if(!selectedTabs.includes('create')) {
            document.querySelector('[data-tab="create"]').click();
        } else if (!selectedTabs.includes('booked')) {
            document.querySelector('[data-tab="booked"]').click();
        } else if (!selectedTabs.includes('scanner')) {
            document.querySelector('[data-tab="scanner"]').click();
        } else {
            // If everything is locked, default to Create but it will show locked
            document.querySelector('[data-tab="create"]').click();
        }

        showToast("Device Locked", "Configuration and selected tabs are now secured on this device.");

    } catch (err) {
        console.error("Lock error:", err);
        alert("Failed to process lock request.");
    }
});

// --- UNLOCK ACTION ---
cancelUnlockBtn.addEventListener('click', () => {
    unlockModal.style.display = 'none';
    unlockPasswordInput.value = '';
    unlockError.style.display = 'none';
});

confirmUnlockBtn.addEventListener('click', () => {
    const enteredPass = unlockPasswordInput.value;
    
    // Compare against GLOBAL password synced from DB
    if(enteredPass === globalPassword) {
        // Unlock this device locally
        localLockState.isLocked = false;
        localLockState.lockedTabs = [];
        saveLocalSecurityState();
        
        applySecurityLocks();
        
        unlockModal.style.display = 'none';
        unlockPasswordInput.value = '';
        unlockError.style.display = 'none';
        
        // Navigate to settings
        document.querySelector('[data-tab="settings"]').click();
        showToast("Device Unlocked", "Access granted.");
    } else {
        unlockError.style.display = 'block';
        unlockPasswordInput.classList.add('shake');
        setTimeout(() => unlockPasswordInput.classList.remove('shake'), 500);
    }
});

async function checkAutoAbsent() {
    if (!eventSettings.deadline || !bookedTickets.length || !currentUser) return;

    const deadlineTime = new Date(eventSettings.deadline).getTime();
    const now = Date.now();
    const BUFFER_MS = 60000;

    let markedAbsentCount = 0;
    let revertedCount = 0;
    const updates = [];

    bookedTickets.forEach(ticket => {
        const ticketRef = doc(db, APP_COLLECTION_ROOT, currentUser.uid, 'tickets', ticket.id);
        
        if (now > (deadlineTime + BUFFER_MS) && ticket.status === 'coming-soon') {
            updates.push(updateDoc(ticketRef, { status: 'absent' }));
            markedAbsentCount++;
        }
        
        if (now < (deadlineTime - BUFFER_MS) && ticket.status === 'absent') {
            updates.push(updateDoc(ticketRef, { status: 'coming-soon' }));
            revertedCount++;
        }
    });

    if (updates.length > 0) {
        await Promise.all(updates);
        if (markedAbsentCount > 0) showToast('Deadline Reached', `${markedAbsentCount} guests automatically marked as absent.`);
        if (revertedCount > 0) showToast('Deadline Extended', `${revertedCount} guests reverted to 'Coming Soon'.`);
    }
}

const navButtons = document.querySelectorAll('.nav-btn');
const tabs = document.querySelectorAll('.tab-content');

// UPDATED NAV LOGIC FOR LOCKING
navButtons.forEach(button => {
    button.addEventListener('click', (e) => {
        const targetTab = button.dataset.tab;

        // Security Check (Local State)
        if (localLockState.isLocked) {
            // Case 1: Clicking Configuration (Always locked if system is locked)
            if (targetTab === 'settings') {
                e.preventDefault();
                unlockModal.style.display = 'flex';
                unlockPasswordInput.focus();
                return; // Stop navigation
            }
            
            // Case 2: Clicking a specifically locked tab
            if (localLockState.lockedTabs.includes(targetTab)) {
                e.preventDefault();
                showToast("Access Denied", "This tab is locked on this device.");
                return; // Stop navigation
            }
        }

        // Standard Navigation Logic
        const scannerVideo = document.getElementById('scanner-video');
        if (scannerVideo.srcObject && button.dataset.tab !== 'scanner') {
            stopScan();
        }

        navButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        tabs.forEach(tab => {
            tab.classList.remove('active');
            if (tab.id === button.dataset.tab) {
                tab.classList.add('active');
            }
        });
    });
});

const eventSettingsForm = document.getElementById('eventSettingsForm');
eventSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const newSettings = {
        name: document.getElementById('eventName').value,
        place: document.getElementById('eventPlace').value,
        deadline: document.getElementById('arrivalDeadline').value
    };

    const settingsRef = doc(db, APP_COLLECTION_ROOT, currentUser.uid, 'settings', 'config');
    await setDoc(settingsRef, newSettings, { merge: true });
    alert('Settings Saved!');
});

function updateSettingsDisplay() {
    document.getElementById('currentEventName').textContent = eventSettings.name || 'Not set';
    document.getElementById('currentEventPlace').textContent = eventSettings.place || 'Not set';
    document.getElementById('currentDeadline').textContent = eventSettings.deadline ? new Date(eventSettings.deadline).toLocaleString() : 'Not set';
    document.getElementById('eventNamePlace').textContent = eventSettings.name && eventSettings.place ? `${eventSettings.name} | ${eventSettings.place}` : 'EVENT DETAILS';
    document.getElementById('eventName').value = eventSettings.name || '';
    document.getElementById('eventPlace').value = eventSettings.place || '';
    document.getElementById('arrivalDeadline').value = eventSettings.deadline || '';
    document.getElementById('modalEventNamePlace').textContent = eventSettings.name && eventSettings.place ? `${eventSettings.name} | ${eventSettings.place}` : 'EVENT DETAILS';
}

const ticketForm = document.getElementById('ticketForm');
ticketForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const name = document.getElementById('name').value;
    const gender = document.getElementById('gender').value;
    const age = document.getElementById('age').value;
    const phone = document.getElementById('phone').value;

    const newTicket = {
        name,
        gender,
        age,
        phone: '+91' + phone,
        status: 'coming-soon',
        scanned: false,
        createdAt: Date.now()
    };

    try {
        const docRef = await addDoc(collection(db, APP_COLLECTION_ROOT, currentUser.uid, 'tickets'), newTicket);
        updateTicketPreview({ ...newTicket, id: docRef.id });
        ticketForm.reset();
    } catch (err) {
        console.error(err);
        alert("Error creating ticket");
    }
});

const bookedTicketsTable = document.getElementById('bookedTicketsTable');

function renderBookedTickets() {
    bookedTicketsTable.innerHTML = '';

    // 1. FILTER
    let displayTickets = bookedTickets.filter(ticket => {
        const matchesSearch = ticket.name.toLowerCase().includes(searchTerm) || ticket.phone.includes(searchTerm);
        if (!matchesSearch) return false;

        if (currentFilter !== 'all' && ticket.status !== currentFilter) return false;
        if (currentGenderFilter !== 'all' && ticket.gender !== currentGenderFilter) return false;

        return true;
    });

    // 2. SORT
    displayTickets.sort((a, b) => {
        if (currentSort === 'newest') return b.createdAt - a.createdAt;
        if (currentSort === 'oldest') return a.createdAt - b.createdAt;
        if (currentSort === 'name-asc') return a.name.localeCompare(b.name);
        if (currentSort === 'name-desc') return b.name.localeCompare(a.name);
        if (currentSort === 'age-asc') return Number(a.age) - Number(b.age);
        if (currentSort === 'age-desc') return Number(b.age) - Number(a.age);
        if (currentSort === 'gender') return a.gender.localeCompare(b.gender);
        return 0;
    });

    currentFilteredTickets = displayTickets;

    if(displayTickets.length === 0) {
        bookedTicketsTable.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 30px; color: #666;">No matching guests found.</td></tr>';
        return;
    }

    displayTickets.forEach(ticket => {
        const tr = document.createElement('tr');
        tr.dataset.id = ticket.id;
        
        let statusHtml = `<span class="status-badge status-${ticket.status}">${ticket.status.replace('-', ' ')}</span>`;
        if(ticket.status === 'arrived' && ticket.scannedAt) {
            const timeStr = new Date(ticket.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            statusHtml += `<div style="font-size: 0.75rem; color: #888; margin-top: 4px; white-space: nowrap;">${timeStr}</div>`;
        }

        const isChecked = selectedTicketIds.has(ticket.id) ? 'checked' : '';

        tr.innerHTML = `
            <td><input type="checkbox" class="ticket-checkbox" style="transform: scale(1.2);" ${isChecked}></td>
            <td style="font-weight: 500; color: white;">${ticket.name}</td>
            <td>${ticket.age} / ${ticket.gender}</td>
            <td>${ticket.phone}</td>
            <td style="font-family: monospace; font-size: 0.8rem; color: #888;">${ticket.id.substring(0, 8)}...</td>
            <td>${statusHtml}</td>
            <td><button class="action-btn-small view-ticket-btn" data-id="${ticket.id}">View</button></td>
        `;
        bookedTicketsTable.appendChild(tr);
    });

    document.querySelectorAll('.view-ticket-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ticket = bookedTickets.find(t => t.id === e.target.dataset.id);
            if(ticket) {
                // MODAL PREVIEW LOGIC (Independent of Create Tab Lock)
                document.getElementById('modalTicketName').textContent = ticket.name;
                document.getElementById('modalTicketAgeGender').textContent = `${ticket.age} / ${ticket.gender}`;
                document.getElementById('modalTicketPhone').textContent = ticket.phone;
                document.getElementById('modalTicketSerial').textContent = `ID: ${ticket.id}`;
                
                const modalQrcodeContainer = document.getElementById('modalQrcode');
                modalQrcodeContainer.innerHTML = '';
                new QRCode(modalQrcodeContainer, {
                    text: ticket.id,
                    width: 100,
                    height: 100,
                    colorDark : "#000000",
                    colorLight : "#ffffff",
                    correctLevel: QRCode.CorrectLevel.H
                });

                ticketViewModal.style.display = 'flex';
            }
        });
    });

    document.querySelectorAll('.ticket-checkbox').forEach(box => {
        box.addEventListener('change', (e) => {
            const rowId = e.target.closest('tr').dataset.id;
            if(e.target.checked) {
                selectedTicketIds.add(rowId);
            } else {
                selectedTicketIds.delete(rowId);
            }
            updateSelectionCount();
        });
    });
}

// Modal WhatsApp Share
modalWhatsAppBtn.addEventListener('click', () => {
    const btn = modalWhatsAppBtn;
    const originalContent = btn.innerHTML;
    btn.textContent = "Processing...";
    btn.disabled = true;

    const ticketTemplate = document.getElementById('modalTicketTemplate');
    const originalBorder = ticketTemplate.style.border;
    ticketTemplate.style.border = 'none';

    html2canvas(ticketTemplate, {
        scale: 3,
        backgroundColor: null, 
        useCORS: true
    }).then(canvas => {
        ticketTemplate.style.border = originalBorder;
        
        const now = new Date();
        const pad = (num) => String(num).padStart(2, '0');
        const timestamp = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        
        const link = document.createElement('a');
        link.download = `ticket-${timestamp}.png`;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(() => {
            const phone = document.getElementById('modalTicketPhone').textContent.replace(/\D/g,'');
            const name = document.getElementById('modalTicketName').textContent;
            const message = encodeURIComponent(`Hello ${name}, here is your Entry Pass 🎫.\n*Keep this QR code ready at the entrance.*`);
            window.location.href = `https://wa.me/${phone}?text=${message}`;
            
            btn.innerHTML = originalContent;
            btn.disabled = false;
        }, 1500);

    }).catch(err => {
        console.error(err);
        alert("Error generating ticket image");
        btn.innerHTML = originalContent;
        btn.disabled = false;
    });
});

closeTicketModal.addEventListener('click', () => {
    ticketViewModal.style.display = 'none';
});


function updateTicketPreview(ticket) {
    document.getElementById('ticketName').textContent = ticket.name;
    document.getElementById('ticketAgeGender').textContent = `${ticket.age} / ${ticket.gender}`;
    document.getElementById('ticketPhone').textContent = ticket.phone;
    document.getElementById('ticketSerial').textContent = `ID: ${ticket.id}`;
    const qrcodeContainer = document.getElementById('qrcode');
    qrcodeContainer.innerHTML = '';
    new QRCode(qrcodeContainer, {
        text: ticket.id,
        width: 100,
        height: 100,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
    document.getElementById('whatsappBtn').disabled = false;
}

document.getElementById('whatsappBtn').addEventListener('click', () => {
    const btn = document.getElementById('whatsappBtn');
    const originalText = btn.textContent;
    btn.textContent = "Processing...";
    btn.disabled = true;

    const ticketTemplate = document.getElementById('ticketTemplate');
    const originalBorder = ticketTemplate.style.border;
    ticketTemplate.style.border = 'none';

    html2canvas(ticketTemplate, {
        scale: 3,
        backgroundColor: null, 
        useCORS: true
    }).then(canvas => {
        ticketTemplate.style.border = originalBorder;

        const now = new Date();
        const pad = (num) => String(num).padStart(2, '0');
        const timestamp = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        
        const link = document.createElement('a');
        link.download = `ticket-${timestamp}.png`;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(() => {
            const phone = document.getElementById('ticketPhone').textContent.replace(/\D/g,'');
            const name = document.getElementById('ticketName').textContent;
            const message = encodeURIComponent(`Hello ${name}, here is your Entry Pass 🎫.\n*Keep this QR code ready at the entrance.*`);
            window.location.href = `https://wa.me/${phone}?text=${message}`;
            btn.textContent = originalText;
            btn.disabled = true;
            document.getElementById('ticketName').textContent = '--';
            document.getElementById('ticketAgeGender').textContent = '-- / --';
            document.getElementById('ticketPhone').textContent = '--';
            document.getElementById('ticketSerial').textContent = 'ID: --';
            document.getElementById('qrcode').innerHTML = '';
            document.getElementById('ticketForm').reset();
        }, 1500);

    }).catch(err => {
        console.error(err);
        alert("Error generating ticket image");
        btn.textContent = originalText;
        btn.disabled = false;
    });
});

const selectBtn = document.getElementById('selectBtn');
const deleteBtn = document.getElementById('deleteBtn');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const selectAllContainer = document.querySelector('.select-all-container');
const selectionCountSpan = document.getElementById('selectionCount');
let isSelectionMode = false;

function updateSelectionCount() {
    const count = selectedTicketIds.size;
    selectionCountSpan.textContent = `(${count} selected)`;
    exportTriggerBtn.disabled = count === 0;
    const allVisibleSelected = currentFilteredTickets.length > 0 && 
                               currentFilteredTickets.every(t => selectedTicketIds.has(t.id));
    if(currentFilteredTickets.length === 0) selectAllCheckbox.checked = false;
    else selectAllCheckbox.checked = allVisibleSelected;
}

selectBtn.addEventListener('click', () => {
    isSelectionMode = !isSelectionMode;
    deleteBtn.style.display = isSelectionMode ? 'inline-block' : 'none';
    selectAllContainer.style.display = isSelectionMode ? 'flex' : 'none'; 
    selectBtn.textContent = isSelectionMode ? 'Cancel' : 'Select';
    if(!isSelectionMode) {
        selectedTicketIds.clear(); 
        renderBookedTickets(); 
        selectAllCheckbox.checked = false;
        updateSelectionCount();
    } else {
        exportTriggerBtn.disabled = true;
    }
});

selectAllCheckbox.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    currentFilteredTickets.forEach(t => {
        if(isChecked) selectedTicketIds.add(t.id);
        else selectedTicketIds.delete(t.id);
    });
    renderBookedTickets();
    updateSelectionCount();
});

deleteBtn.addEventListener('click', () => {
    const selectedIds = Array.from(selectedTicketIds);
    if(selectedIds.length === 0) return alert('Select tickets to delete');
    pendingDeleteIds = selectedIds;
    deleteCountSpan.textContent = selectedIds.length;
    confirmModal.style.display = 'flex';
});

cancelDeleteBtn.addEventListener('click', () => {
    confirmModal.style.display = 'none';
    pendingDeleteIds = [];
});

confirmDeleteBtn.addEventListener('click', async () => {
    if(pendingDeleteIds.length > 0) {
        confirmDeleteBtn.textContent = "Deleting...";
        for(const id of pendingDeleteIds) {
            await deleteDoc(doc(db, APP_COLLECTION_ROOT, currentUser.uid, 'tickets', id));
        }
        confirmModal.style.display = 'none';
        confirmDeleteBtn.textContent = "Delete";
        pendingDeleteIds = [];
        selectedTicketIds.clear(); 
        selectBtn.click(); 
    }
});

const startScanBtn = document.getElementById('startScanBtn');
const scannerVideo = document.getElementById('scanner-video');
const scanResult = document.getElementById('scanResult');

startScanBtn.addEventListener('click', () => {
    if (scannerVideo.srcObject) stopScan();
    else startScan();
});

function startScan() {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
            scannerVideo.srcObject = stream;
            scannerVideo.setAttribute("playsinline", true); 
            scannerVideo.play();
            startScanBtn.textContent = 'Deactivate Camera';
            scanResult.style.display = 'block';
            scanResult.style.background = 'rgba(255,255,255,0.1)';
            scanResult.style.color = 'white';
            scanResult.textContent = 'Searching for QR Code...';
            requestAnimationFrame(tick);
        }).catch(err => {
            alert("Camera error: " + err);
        });
}

function stopScan() {
    if (scannerVideo.srcObject) scannerVideo.srcObject.getTracks().forEach(t => t.stop());
    scannerVideo.srcObject = null;
    startScanBtn.textContent = 'Activate Camera';
}

let isCooldown = false; 

function tick() {
    if (!scannerVideo.srcObject) return;
    if (scannerVideo.readyState === scannerVideo.HAVE_ENOUGH_DATA) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = scannerVideo.videoWidth;
        canvas.height = scannerVideo.videoHeight;
        ctx.drawImage(scannerVideo, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0,0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
        if(code && !isCooldown) {
            isCooldown = true;
            validateTicket(code.data);
            setTimeout(() => {
                isCooldown = false;
            }, 1500);
        }
    }
    if (scannerVideo.srcObject) {
        requestAnimationFrame(tick);
    }
}

async function validateTicket(ticketId) {
    const ticket = bookedTickets.find(t => t.id === ticketId);
    scanResult.style.display = 'block';
    if(ticket) {
        if(ticket.status === 'coming-soon' && !ticket.scanned) {
            await updateDoc(doc(db, APP_COLLECTION_ROOT, currentUser.uid, 'tickets', ticketId), {
                status: 'arrived',
                scanned: true,
                scannedAt: Date.now()
            });
            scanResult.style.background = 'rgba(16, 185, 129, 0.2)';
            scanResult.style.color = '#10b981';
            scanResult.style.border = '1px solid #10b981';
            scanResult.textContent = `✅ ACCESS GRANTED: ${ticket.name}`;
            playBeep();
        } else {
            scanResult.style.background = 'rgba(239, 68, 68, 0.2)';
            scanResult.style.color = '#ef4444';
            scanResult.style.border = '1px solid #ef4444';
            scanResult.textContent = `❌ DENIED: Already Scanned or Invalid Status`;
            playError();
        }
    } else {
        scanResult.style.background = 'rgba(239, 68, 68, 0.2)';
        scanResult.style.color = '#ef4444';
        scanResult.textContent = `❌ DENIED: Invalid Ticket ID`;
        playError();
    }
}

function playBeep() {
    const audio = new Audio('success.mp3');
    audio.play().catch(e => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.connect(ctx.destination);
        osc.frequency.value = 800;
        osc.start();
        setTimeout(() => osc.stop(), 100);
    });
}

function playError() {
    const audio = new Audio('error.mp3');
    audio.play().catch(e => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.connect(ctx.destination);
        osc.frequency.value = 150;
        osc.start();
        setTimeout(() => osc.stop(), 300);
    });
}

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/service-worker.js").catch(err => console.log("SW failed:", err));
    });
}

// --- SIDE CONTACT TRAY LOGIC ---
const contactTray = document.getElementById('contactTray');
const trayToggle = document.getElementById('trayToggle');
const trayIcon = document.getElementById('trayIcon');

if (trayToggle && contactTray) {
    trayToggle.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent closing immediately if we add document click listener
        contactTray.classList.toggle('open');
        
        // Toggle Icon
        if (contactTray.classList.contains('open')) {
            trayIcon.classList.remove('fa-chevron-left');
            trayIcon.classList.add('fa-chevron-right');
            
            // Add Blur Effect to content
            document.getElementById('appContent').classList.add('content-blur');
            document.getElementById('star-container').classList.add('content-blur');
        } else {
            trayIcon.classList.remove('fa-chevron-right');
            trayIcon.classList.add('fa-chevron-left');
            
            // Remove Blur Effect
            document.getElementById('appContent').classList.remove('content-blur');
            document.getElementById('star-container').classList.remove('content-blur');
        }
    });

    // Close tray when clicking outside
    document.addEventListener('click', (e) => {
        if (contactTray.classList.contains('open') && 
            !contactTray.contains(e.target) && 
            !trayToggle.contains(e.target)) {
            
            contactTray.classList.remove('open');
            trayIcon.classList.remove('fa-chevron-right');
            trayIcon.classList.add('fa-chevron-left');
            
            // Remove Blur Effect
            document.getElementById('appContent').classList.remove('content-blur');
            document.getElementById('star-container').classList.remove('content-blur');
        }
    });
}
