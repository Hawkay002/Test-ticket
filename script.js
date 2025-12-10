import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, collection, doc, setDoc, addDoc, onSnapshot, 
    getDocs, query, deleteDoc, updateDoc, getDoc, serverTimestamp, 
    where, orderBy 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
const ADMIN_EMAIL = "admin.test@gmail.com";

let currentUser = null;
let ticketsUnsubscribe = null;
let settingsUnsubscribe = null;
let securityUnsubscribe = null;
let remoteLockUnsubscribe = null;
let autoCheckInterval = null;
let deviceRefreshInterval = null;

// ==========================================
// SESSION & DEVICE TRACKING
// ==========================================
let currentSessionId = null;

// --- SECURITY STATE ---
let globalPassword = "";
let localLockState = {
    isLocked: false,
    lockedTabs: []
};

// --- STATE MANAGEMENT ---
let selectedTicketIds = new Set();
let bookedTickets = [];
let eventSettings = { name: '', place: '', deadline: '' };

// --- ADMIN STATE ---
let allUsersSessions = [];
let selectedUserForLock = null;
let lastDeviceRefreshTime = null;

// --- SEARCH & FILTER STATE ---
let searchTerm = '';
let currentFilter = 'all';
let currentGenderFilter = 'all';
let currentSort = 'newest';
let currentFilteredTickets = [];

// ==========================================
// INITIALIZATION FUNCTIONS
// ==========================================

// Star Background
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

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

// Toast Notifications
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

// Connection Status
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

// ==========================================
// SESSION MANAGEMENT
// ==========================================

function initSessionTracking(userId) {
    currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store user email for admin lookup
    storeUserEmail(userId, currentUser.email);
    
    // Store session info
    const sessionRef = doc(db, APP_COLLECTION_ROOT, userId, 'sessions', currentSessionId);
    setDoc(sessionRef, {
        email: currentUser.email,
        lastActive: serverTimestamp(),
        isActive: true,
        deviceInfo: getDeviceInfo(),
        userAgent: navigator.userAgent
    }, { merge: true });
    
    // Update session activity every 30 seconds
    const sessionInterval = setInterval(() => {
        if (currentUser) {
            updateDoc(sessionRef, {
                lastActive: serverTimestamp(),
                isActive: true
            });
        } else {
            clearInterval(sessionInterval);
        }
    }, 30000);
}

function cleanupSession(userId) {
    if (currentSessionId && userId) {
        const sessionRef = doc(db, APP_COLLECTION_ROOT, userId, 'sessions', currentSessionId);
        updateDoc(sessionRef, {
            isActive: false,
            endedAt: serverTimestamp()
        }).catch(() => {});
    }
}

function getDeviceInfo() {
    return {
        platform: navigator.platform,
        language: navigator.language,
        screen: `${window.screen.width}x${window.screen.height}`,
        online: navigator.onLine,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
}

async function storeUserEmail(userId, email) {
    try {
        await setDoc(doc(db, 'user_emails', userId), {
            email: email,
            lastLogin: serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error("Error storing email:", error);
    }
}

// ==========================================
// ADMIN FUNCTIONS WITH REFRESH BUTTON
// ==========================================

function isAdmin() {
    return currentUser && currentUser.email === ADMIN_EMAIL;
}

async function loadAllUserSessions() {
    if (!isAdmin() || !currentUser) return;
    
    try {
        // Get all users collection
        const usersSnapshot = await getDocs(collection(db, APP_COLLECTION_ROOT));
        allUsersSessions = [];
        
        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            
            // Skip current admin user
            if (userId === currentUser.uid) continue;
            
            // Get user's email
            let userEmail = `User_${userId.substring(0, 8)}`;
            try {
                const emailDoc = await getDoc(doc(db, 'user_emails', userId));
                if (emailDoc.exists()) {
                    userEmail = emailDoc.data().email;
                }
            } catch (e) {
                console.log("Could not fetch email for user:", userId);
            }
            
            // Get active sessions
            const sessionsRef = collection(db, APP_COLLECTION_ROOT, userId, 'sessions');
            const sessionsSnapshot = await getDocs(query(sessionsRef, where('isActive', '==', true)));
            
            sessionsSnapshot.forEach(sessionDoc => {
                const sessionData = sessionDoc.data();
                allUsersSessions.push({
                    userId,
                    userEmail,
                    sessionId: sessionDoc.id,
                    lastActive: sessionData.lastActive?.toDate() || new Date(),
                    deviceInfo: sessionData.deviceInfo || {},
                    userAgent: sessionData.userAgent || 'Unknown'
                });
            });
        }
        
        // Update last refresh time
        lastDeviceRefreshTime = new Date();
        renderConnectedDevices();
        
        // Update refresh button state
        const refreshBtn = document.getElementById('refreshDevicesBtn');
        if (refreshBtn) {
            refreshBtn.classList.remove('refreshing');
            refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh';
        }
        
    } catch (error) {
        console.error("Error loading sessions:", error);
        
        // Update refresh button state even on error
        const refreshBtn = document.getElementById('refreshDevicesBtn');
        if (refreshBtn) {
            refreshBtn.classList.remove('refreshing');
            refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh';
        }
        
        // Check if it's a permissions error
        if (error.code === 'permission-denied') {
            console.warn("Admin doesn't have permission to view other users' data");
            const container = document.getElementById('connectedDevicesList');
            if (container) {
                container.innerHTML = `
                    <div style="text-align: center; color: #ef4444; padding: 20px;">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <p style="margin-top: 10px;">Admin permissions required to view connected devices.</p>
                        <p style="font-size: 0.8rem; color: #888;">Update Firestore rules to allow admin access.</p>
                    </div>
                `;
            }
        }
    }
}

async function refreshDevices() {
    const refreshBtn = document.getElementById('refreshDevicesBtn');
    if (refreshBtn) {
        refreshBtn.classList.add('refreshing');
        refreshBtn.innerHTML = '<i class="fa-solid fa-spinner"></i> Refreshing...';
    }
    
    await loadAllUserSessions();
    showToast("Devices Refreshed", "Device list has been updated.");
}

function renderConnectedDevices() {
    const container = document.getElementById('connectedDevicesList');
    if (!container) return;
    
    // Calculate device statistics
    const now = Date.now();
    const onlineDevices = allUsersSessions.filter(session => 
        (now - session.lastActive.getTime()) < 60000
    ).length;
    const offlineDevices = allUsersSessions.length - onlineDevices;
    const totalDevices = allUsersSessions.length;
    
    if (allUsersSessions.length === 0) {
        container.innerHTML = `
            <div class="device-stats">
                <div class="stat-card">
                    <span class="stat-value">0</span>
                    <span class="stat-label">Total Devices</span>
                </div>
                <div class="stat-card">
                    <span class="stat-value stat-online">0</span>
                    <span class="stat-label">Online</span>
                </div>
                <div class="stat-card">
                    <span class="stat-value stat-offline">0</span>
                    <span class="stat-label">Offline</span>
                </div>
            </div>
            <div style="text-align: center; color: #666; padding: 20px;">
                <i class="fa-solid fa-user-slash"></i> No other devices connected
            </div>
            ${lastDeviceRefreshTime ? 
                `<div class="last-refresh-time">Last refreshed: ${lastDeviceRefreshTime.toLocaleTimeString()}</div>` : 
                ''
            }
        `;
        return;
    }
    
    // Create device list HTML
    let devicesHTML = `
        <div class="device-stats">
            <div class="stat-card">
                <span class="stat-value">${totalDevices}</span>
                <span class="stat-label">Total Devices</span>
            </div>
            <div class="stat-card">
                <span class="stat-value stat-online">${onlineDevices}</span>
                <span class="stat-label">Online</span>
            </div>
            <div class="stat-card">
                <span class="stat-value stat-offline">${offlineDevices}</span>
                <span class="stat-label">Offline</span>
            </div>
        </div>
    `;
    
    allUsersSessions.forEach((session, index) => {
        const timeAgo = getTimeAgo(session.lastActive);
        const isOnline = (Date.now() - session.lastActive.getTime()) < 60000;
        
        devicesHTML += `
            <div class="device-card" data-user-id="${session.userId}" data-session-id="${session.sessionId}" 
                 style="background: ${isOnline ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)'}; 
                        border: 1px solid ${isOnline ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; 
                        border-radius: 10px; padding: 15px; margin-bottom: 10px; cursor: pointer; transition: all 0.3s;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 5px;">
                            <i class="fa-solid fa-laptop" style="color: ${isOnline ? '#10b981' : '#ef4444'};"></i>
                            <span style="font-weight: 500; color: white;">${session.userEmail}</span>
                            <span class="status-badge" style="background: ${isOnline ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; 
                                        color: ${isOnline ? '#10b981' : '#ef4444'}; font-size: 0.7rem;">
                                ${isOnline ? 'Online' : 'Offline'}
                            </span>
                        </div>
                        <div style="font-size: 0.75rem; color: #888;">
                            <div>${session.deviceInfo.platform || 'Unknown device'} • ${session.deviceInfo.screen || 'Unknown screen'}</div>
                            <div>Last active: ${timeAgo}</div>
                        </div>
                    </div>
                    <div>
                        <button class="action-btn-small lock-device-btn" style="font-size: 0.8rem;">
                            <i class="fa-solid fa-lock"></i> Manage
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    
    // Add last refresh time
    if (lastDeviceRefreshTime) {
        devicesHTML += `<div class="last-refresh-time">Last refreshed: ${lastDeviceRefreshTime.toLocaleTimeString()}</div>`;
    }
    
    container.innerHTML = devicesHTML;
    
    // Add event listeners to device cards
    document.querySelectorAll('.device-card').forEach(card => {
        const lockBtn = card.querySelector('.lock-device-btn');
        if (lockBtn) {
            lockBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const userId = card.dataset.userId;
                const userEmail = card.querySelector('span[style*="font-weight: 500"]').textContent;
                showAdminLockControls(userId, userEmail);
            });
        }
    });
}

function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function showAdminLockControls(userId, userEmail) {
    selectedUserForLock = userId;
    document.getElementById('targetUserEmail').textContent = userEmail;
    document.getElementById('adminLockControls').style.display = 'block';
    
    // Scroll to controls
    document.getElementById('adminLockControls').scrollIntoView({ behavior: 'smooth' });
}

function hideAdminLockControls() {
    selectedUserForLock = null;
    document.getElementById('adminLockControls').style.display = 'none';
    document.querySelectorAll('.admin-lock-checkbox').forEach(cb => cb.checked = false);
    document.getElementById('adminLockPassword').value = '';
}

async function applyAdminLockToUser() {
    if (!selectedUserForLock || !isAdmin()) return;
    
    const password = document.getElementById('adminLockPassword').value;
    if (!password) {
        alert("Please enter a lock password");
        return;
    }
    
    const tabsToLock = [];
    document.querySelectorAll('.admin-lock-checkbox:checked').forEach(cb => {
        tabsToLock.push(cb.value);
    });
    
    if (tabsToLock.length === 0) {
        alert("Please select at least one tab to lock");
        return;
    }
    
    try {
        // Store the lock command in target user's security collection
        const lockCommandRef = doc(db, APP_COLLECTION_ROOT, selectedUserForLock, 'security', 'remote_lock');
        
        await setDoc(lockCommandRef, {
            isLocked: true,
            lockedTabs: tabsToLock,
            password: password,
            lockedBy: currentUser.email,
            lockedAt: serverTimestamp(),
            commandId: `lock_${Date.now()}`
        }, { merge: true });
        
        showToast("Lock Command Sent", `Tabs locked for user in real-time`);
        hideAdminLockControls();
        
    } catch (error) {
        console.error("Error applying lock:", error);
        alert("Failed to apply lock");
    }
}

function setupRemoteLockListener(userId) {
    if (remoteLockUnsubscribe) remoteLockUnsubscribe();
    
    const remoteLockRef = doc(db, APP_COLLECTION_ROOT, userId, 'security', 'remote_lock');
    
    remoteLockUnsubscribe = onSnapshot(remoteLockRef, (docSnap) => {
        if (docSnap.exists()) {
            const lockData = docSnap.data();
            
            // Apply the remote lock locally
            localLockState = {
                isLocked: lockData.isLocked || false,
                lockedTabs: lockData.lockedTabs || []
            };
            
            // Update global password if provided
            if (lockData.password) {
                globalPassword = lockData.password;
            }
            
            saveLocalSecurityState();
            applySecurityLocks();
            
            showToast("Remote Lock Applied", "Admin has locked tabs on this device");
        }
    });
}

// ==========================================
// SECURITY FUNCTIONS
// ==========================================

function loadLocalSecurityState(userId) {
    const stored = localStorage.getItem(`ticketApp_lockState_${userId}`);
    if (stored) {
        localLockState = JSON.parse(stored);
    } else {
        localLockState = { isLocked: false, lockedTabs: [] };
    }
}

function saveLocalSecurityState() {
    if (currentUser) {
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
        // Mark Configuration as locked visually
        const settingsBtn = document.querySelector('[data-tab="settings"]');
        if (settingsBtn) settingsBtn.classList.add('locked');
        
        // Mark selected tabs as locked visually
        lockedTabs.forEach(tabName => {
            const btn = document.querySelector(`[data-tab="${tabName}"]`);
            if (btn) btn.classList.add('locked');
        });

        // Update Lock Controls UI
        if (lockSystemBtn) {
            lockSystemBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Locked';
            lockSystemBtn.classList.add('active');
        }
        
        // Fill checkboxes based on state & disable them
        lockCheckboxes.forEach(cb => {
            cb.checked = lockedTabs.includes(cb.value);
            cb.disabled = true;
        });
        
        if (lockPasswordInput) {
            lockPasswordInput.disabled = true;
            lockPasswordInput.value = '';
        }
        
        if (lockSystemBtn) lockSystemBtn.disabled = true;
    } else {
        // Unlocked State
        lockCheckboxes.forEach(cb => {
            cb.disabled = false;
        });
        
        if (lockPasswordInput) {
            lockPasswordInput.disabled = false;
        }
        
        if (lockSystemBtn) {
            lockSystemBtn.disabled = false;
            lockSystemBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Lock Tabs';
            lockSystemBtn.classList.remove('active');
        }
    }
}

// ==========================================
// SYNC & REFRESH FUNCTIONS
// ==========================================

async function performSync() {
    if (!currentUser) return;
    
    const icon = refreshStatusIndicator?.querySelector('i');
    if (icon) {
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
        
        // Refresh admin device list if admin
        if (isAdmin()) {
            loadAllUserSessions();
        }
    } catch (err) {
        console.error("Auto-sync error:", err);
    } finally {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 1000 - elapsed);
        setTimeout(() => {
            if (icon) {
                icon.classList.remove('fa-spin');
                icon.style.color = '';
            }
        }, remaining);
    }
}

// ==========================================
// EVENT LISTENERS SETUP
// ==========================================

// DOM Elements
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

// Admin Elements
const adminPanel = document.getElementById('adminPanel');
const cancelAdminLockBtn = document.getElementById('cancelAdminLock');
const applyAdminLockBtn = document.getElementById('applyAdminLock');
const toggleAdminPassword = document.getElementById('toggleAdminPassword');
const adminLockPassword = document.getElementById('adminLockPassword');
const refreshDevicesBtn = document.getElementById('refreshDevicesBtn');

// Password Toggle Logic
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

if (toggleAdminPassword && adminLockPassword) {
    toggleAdminPassword.addEventListener('click', function () {
        const type = adminLockPassword.getAttribute('type') === 'password' ? 'text' : 'password';
        adminLockPassword.setAttribute('type', type);
        this.classList.toggle('fa-eye');
        this.classList.toggle('fa-eye-slash');
    });
}

// Refresh Status Indicator
if (refreshStatusIndicator) {
    refreshStatusIndicator.addEventListener('click', performSync);
}

// Refresh Devices Button
if (refreshDevicesBtn) {
    refreshDevicesBtn.addEventListener('click', refreshDevices);
}

// Admin Controls
if (cancelAdminLockBtn) {
    cancelAdminLockBtn.addEventListener('click', hideAdminLockControls);
}

if (applyAdminLockBtn) {
    applyAdminLockBtn.addEventListener('click', applyAdminLockToUser);
}

// ==========================================
// AUTHENTICATION
// ==========================================

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        userEmailDisplay.textContent = user.email;
        loadingScreen.style.display = 'none';
        loginOverlay.style.display = 'none';
        appContent.style.display = 'block';
        
        // Initialize session tracking
        initSessionTracking(user.uid);
        
        // Setup listeners
        setupRealtimeListeners(user.uid);
        setupRemoteLockListener(user.uid);
        
        // Initialize Local Security State
        loadLocalSecurityState(user.uid);
        applySecurityLocks();
        
        // Show/Hide admin panel
        if (isAdmin() && adminPanel) {
            adminPanel.style.display = 'block';
            loadAllUserSessions();
            // Set up auto-refresh every 30 seconds
            if (deviceRefreshInterval) clearInterval(deviceRefreshInterval);
            deviceRefreshInterval = setInterval(loadAllUserSessions, 30000);
        } else if (adminPanel) {
            adminPanel.style.display = 'none';
        }
        
        if (autoCheckInterval) clearInterval(autoCheckInterval);
        autoCheckInterval = setInterval(performSync, 15000);
        
        updateOnlineStatus();
    } else {
        // Cleanup session on logout
        if (currentUser) {
            cleanupSession(currentUser.uid);
        }
        
        // Clear intervals
        if (deviceRefreshInterval) clearInterval(deviceRefreshInterval);
        
        currentUser = null;
        loadingScreen.style.display = 'none';
        loginOverlay.style.display = 'flex';
        appContent.style.display = 'none';
        
        if (ticketsUnsubscribe) ticketsUnsubscribe();
        if (settingsUnsubscribe) settingsUnsubscribe();
        if (securityUnsubscribe) securityUnsubscribe();
        if (remoteLockUnsubscribe) remoteLockUnsubscribe();
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

// ==========================================
// FIREBASE LISTENERS
// ==========================================

function setupRealtimeListeners(userId) {
    // Tickets listener
    const ticketsRef = collection(db, APP_COLLECTION_ROOT, userId, 'tickets');
    const q = query(ticketsRef);
    
    if (ticketsUnsubscribe) ticketsUnsubscribe();
    ticketsUnsubscribe = onSnapshot(q, (snapshot) => {
        bookedTickets = [];
        snapshot.forEach((doc) => {
            bookedTickets.push({ id: doc.id, ...doc.data() });
        });
        renderBookedTickets();
        checkAutoAbsent();
    });

    // Settings listener
    const settingsRef = doc(db, APP_COLLECTION_ROOT, userId, 'settings', 'config');
    if (settingsUnsubscribe) settingsUnsubscribe();
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

    // Security listener (Global Password)
    const securityRef = doc(db, APP_COLLECTION_ROOT, userId, 'settings', 'security');
    if (securityUnsubscribe) securityUnsubscribe();
    securityUnsubscribe = onSnapshot(securityRef, (docSnap) => {
        if (docSnap.exists()) {
            globalPassword = docSnap.data().password || "";
        } else {
            globalPassword = "";
        }
    });
}

// ==========================================
// TICKET MANAGEMENT
// ==========================================

const ticketForm = document.getElementById('ticketForm');
if (ticketForm) {
    ticketForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;

        const name = document.getElementById('name').value;
        const gender = document.getElementById('gender').value;
        const age = document.getElementById('age').value;
        const phone = document.getElementById('phone').value;

        // Security check for locked tab
        if (localLockState.isLocked && localLockState.lockedTabs.includes('create')) {
            showToast("Access Denied", "Issue Ticket tab is locked on this device.");
            return;
        }

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
}

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
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
    const whatsappBtn = document.getElementById('whatsappBtn');
    if (whatsappBtn) whatsappBtn.disabled = false;
}

// ==========================================
// BOOKED TICKETS TABLE
// ==========================================

const bookedTicketsTable = document.getElementById('bookedTicketsTable');
let isSelectionMode = false;

function renderBookedTickets() {
    if (!bookedTicketsTable) return;
    
    bookedTicketsTable.innerHTML = '';

    // Handle header visibility for checkbox column
    const checkHeader = document.querySelector('.tickets-table thead th:first-child');
    if (checkHeader) {
        checkHeader.style.display = isSelectionMode ? 'table-cell' : 'none';
    }

    // 1. FILTER
    let displayTickets = bookedTickets.filter(ticket => {
        const matchesSearch = ticket.name.toLowerCase().includes(searchTerm) || 
                             ticket.phone.includes(searchTerm);
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

    if (displayTickets.length === 0) {
        bookedTicketsTable.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 30px; color: #666;">No matching guests found.</td></tr>';
        return;
    }

    // Display logic for the checkbox column in rows
    const checkboxDisplayStyle = isSelectionMode ? 'table-cell' : 'none';

    displayTickets.forEach((ticket, index) => {
        const tr = document.createElement('tr');
        tr.dataset.id = ticket.id;
        
        let statusHtml = `<span class="status-badge status-${ticket.status}">${ticket.status.replace('-', ' ')}</span>`;
        if (ticket.status === 'arrived' && ticket.scannedAt) {
            const dateObj = new Date(ticket.scannedAt);
            
            // Format Date: DD/MMM/YYYY
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = dateObj.toLocaleString('en-US', { month: 'short' }).toUpperCase();
            const year = dateObj.getFullYear();
            const dateStr = `${day}/${month}/${year}`;

            // Format Time: HH:MM:SS AM/PM
            const timeStr = dateObj.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit', 
                hour12: true 
            });

            statusHtml += `<div style="font-size: 0.6rem; color: #888; margin-top: 3px; white-space: nowrap;">On - ${dateStr}</div>`;
            statusHtml += `<div style="font-size: 0.6rem; color: #888; white-space: nowrap;">At - ${timeStr}</div>`;
        }

        const isChecked = selectedTicketIds.has(ticket.id) ? 'checked' : '';

        tr.innerHTML = `
            <td style="display: ${checkboxDisplayStyle};"><input type="checkbox" class="ticket-checkbox" style="transform: scale(1.2);" ${isChecked}></td>
            <td style="text-align: center; color: var(--accent-secondary); font-weight: bold;">${index + 1}</td>
            <td style="font-weight: 500; color: white;">${ticket.name}</td>
            <td>
                <div style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">
                    <span>${ticket.age}</span>
                    <span style="color: #444;">|</span>
                    <span>${ticket.gender}</span>
                </div>
            </td>
            <td>${ticket.phone}</td>
            <td style="font-family: monospace; font-size: 0.8rem; color: #888;">${ticket.id.substring(0, 8)}...</td>
            <td>${statusHtml}</td>
            <td><button class="action-btn-small view-ticket-btn" data-id="${ticket.id}">View</button></td>
        `;
        bookedTicketsTable.appendChild(tr);
    });

    // Add event listeners
    document.querySelectorAll('.view-ticket-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ticket = bookedTickets.find(t => t.id === e.target.dataset.id);
            if (ticket) {
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
                    colorDark: "#000000",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.H
                });

                ticketViewModal.style.display = 'flex';
            }
        });
    });

    document.querySelectorAll('.ticket-checkbox').forEach(box => {
        box.addEventListener('change', (e) => {
            const rowId = e.target.closest('tr').dataset.id;
            if (e.target.checked) {
                selectedTicketIds.add(rowId);
            } else {
                selectedTicketIds.delete(rowId);
            }
            updateSelectionCount();
        });
    });
}

// ==========================================
// SELECTION MODE FUNCTIONS
// ==========================================

const selectBtn = document.getElementById('selectBtn');
const deleteBtn = document.getElementById('deleteBtn');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const selectAllContainer = document.querySelector('.select-all-container');
const selectionCountSpan = document.getElementById('selectionCount');

if (selectBtn) {
    selectBtn.addEventListener('click', () => {
        // Security check for locked tab
        if (localLockState.isLocked && localLockState.lockedTabs.includes('booked')) {
            showToast("Access Denied", "Guest List tab is locked on this device.");
            return;
        }
        
        isSelectionMode = !isSelectionMode;
        if (deleteBtn) deleteBtn.style.display = isSelectionMode ? 'inline-block' : 'none';
        if (selectAllContainer) selectAllContainer.style.display = isSelectionMode ? 'flex' : 'none';
        selectBtn.textContent = isSelectionMode ? 'Cancel' : 'Select';
        if (!isSelectionMode) {
            selectedTicketIds.clear();
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            updateSelectionCount();
        } else {
            if (exportTriggerBtn) exportTriggerBtn.disabled = true;
        }
        renderBookedTickets();
    });
}

if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        currentFilteredTickets.forEach(t => {
            if (isChecked) selectedTicketIds.add(t.id);
            else selectedTicketIds.delete(t.id);
        });
        renderBookedTickets();
        updateSelectionCount();
    });
}

function updateSelectionCount() {
    const count = selectedTicketIds.size;
    if (selectionCountSpan) selectionCountSpan.textContent = `(${count} selected)`;
    if (exportTriggerBtn) exportTriggerBtn.disabled = count === 0;
    const allVisibleSelected = currentFilteredTickets.length > 0 && 
                               currentFilteredTickets.every(t => selectedTicketIds.has(t.id));
    if (currentFilteredTickets.length === 0 && selectAllCheckbox) selectAllCheckbox.checked = false;
    else if (selectAllCheckbox) selectAllCheckbox.checked = allVisibleSelected;
}

// ==========================================
// DELETE FUNCTIONALITY
// ==========================================

if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
        const selectedIds = Array.from(selectedTicketIds);
        if (selectedIds.length === 0) return alert('Select tickets to delete');
        pendingDeleteIds = selectedIds;
        if (deleteCountSpan) deleteCountSpan.textContent = selectedIds.length;
        if (confirmModal) confirmModal.style.display = 'flex';
    });
}

if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener('click', () => {
        if (confirmModal) confirmModal.style.display = 'none';
        pendingDeleteIds = [];
    });
}

if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async () => {
        if (pendingDeleteIds.length > 0) {
            confirmDeleteBtn.textContent = "Deleting...";
            for (const id of pendingDeleteIds) {
                await deleteDoc(doc(db, APP_COLLECTION_ROOT, currentUser.uid, 'tickets', id));
            }
            if (confirmModal) confirmModal.style.display = 'none';
            confirmDeleteBtn.textContent = "Delete";
            pendingDeleteIds = [];
            selectedTicketIds.clear();
            if (selectBtn) selectBtn.click();
        }
    });
}

// ==========================================
// EXPORT FUNCTIONALITY
// ==========================================

if (exportTriggerBtn) {
    exportTriggerBtn.addEventListener('click', () => {
        const count = selectedTicketIds.size;
        if (count === 0) return;
        if (exportCountMsg) exportCountMsg.textContent = `Ready to export ${count} item${count !== 1 ? 's' : ''}.`;
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '_');
        if (exportFileName) exportFileName.value = `guest_list_${today}`;
        if (exportModal) exportModal.style.display = 'flex';
    });
}

if (cancelExportBtn) {
    cancelExportBtn.addEventListener('click', () => {
        if (exportModal) exportModal.style.display = 'none';
    });
}

if (confirmExportBtn) {
    confirmExportBtn.addEventListener('click', () => {
        const filename = exportFileName ? exportFileName.value : 'guest_list';
        const format = exportFormat ? exportFormat.value : 'csv';
        
        let listToExport = [];
        
        if (selectedTicketIds.size > 0) {
            listToExport = currentFilteredTickets.filter(t => selectedTicketIds.has(t.id));
        } else {
            if (exportModal) exportModal.style.display = 'none';
            return alert("No data selected to export.");
        }
        
        switch (format) {
            case 'csv': exportCSV(listToExport, filename); break;
            case 'xlsx': exportXLSX(listToExport, filename); break;
            case 'pdf': exportPDF(listToExport, filename); break;
            case 'txt': exportTXT(listToExport, filename); break;
            case 'json': exportJSON(listToExport, filename); break;
            case 'doc': exportDOC(listToExport, filename); break;
        }
        if (exportModal) exportModal.style.display = 'none';
        showToast("Export Complete", `${listToExport.length} records saved as .${format}`);
    });
}

function exportCSV(data, filename) {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "S.No.,Guest Name,Age,Gender,Phone,Status,Ticket ID,Entry Time\n";
    data.forEach((row, index) => {
        const scannedTime = row.scannedAt ? new Date(row.scannedAt).toLocaleTimeString() : "";
        const cleanName = row.name.replace(/,/g, "");
        const rowStr = `${index + 1},${cleanName},${row.age},${row.gender},${row.phone},${row.status},${row.id},${scannedTime}`;
        csvContent += rowStr + "\n";
    });
    downloadFile(encodeURI(csvContent), `${filename}.csv`);
}

function exportXLSX(data, filename) {
    const worksheetData = data.map((row, index) => ({
        "S.No.": index + 1,
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
    const tableColumn = ["#", "Name", "Age", "Gender", "Phone", "Status", "Entry Time"];
    const tableRows = [];
    data.forEach((row, index) => {
        tableRows.push([
            index + 1,
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
        content += `${i + 1}. ${row.name.toUpperCase()} \n`;
        content += `   Details: ${row.age} / ${row.gender}\n`;
        content += `   Phone: ${row.phone}\n`;
        content += `   Status: ${row.status.toUpperCase()}\n`;
        if (row.scannedAt) content += `   Entry: ${new Date(row.scannedAt).toLocaleTimeString()}\n`;
        content += `   ID: ${row.id}\n`;
        content += "----------------------------------------\n";
    });
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    downloadFile(url, `${filename}.txt`);
}

function exportJSON(data, filename) {
    const jsonWithSerial = data.map((item, index) => ({
        s_no: index + 1,
        ...item
    }));
    const jsonStr = JSON.stringify(jsonWithSerial, null, 2);
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
                <th>S.No.</th><th>Name</th><th>Age/Gender</th><th>Phone</th><th>Status</th>
            </tr>
    `;
    data.forEach((row, index) => {
        htmlBody += `<tr><td>${index + 1}</td><td>${row.name}</td><td>${row.age} / ${row.gender}</td><td>${row.phone}</td><td>${row.status}</td></tr>`;
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

// ==========================================
// SEARCH & FILTER
// ==========================================

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value.toLowerCase().trim();
        renderBookedTickets();
    });
}

if (filterSortBtn) {
    filterSortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (filterDropdown) filterDropdown.classList.toggle('show');
    });
}

window.addEventListener('click', () => {
    if (filterDropdown) filterDropdown.classList.remove('show');
});

document.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = item.dataset.type;
        const val = item.dataset.val;
        document.querySelectorAll(`.dropdown-item[data-type="${type}"]`).forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');

        if (type === 'filter') currentFilter = val;
        if (type === 'filter-gender') currentGenderFilter = val;
        if (type === 'sort') currentSort = val;

        renderBookedTickets();
        if (filterDropdown) filterDropdown.classList.remove('show');
    });
});

// ==========================================
// NAVIGATION
// ==========================================

const navButtons = document.querySelectorAll('.nav-btn');
const tabs = document.querySelectorAll('.tab-content');

navButtons.forEach(button => {
    button.addEventListener('click', (e) => {
        const targetTab = button.dataset.tab;

        // Security Check (Local State)
        if (localLockState.isLocked) {
            // Case 1: Clicking Configuration (Always locked if system is locked)
            if (targetTab === 'settings') {
                e.preventDefault();
                if (unlockModal) {
                    unlockModal.style.display = 'flex';
                    if (unlockPasswordInput) unlockPasswordInput.focus();
                }
                return;
            }
            
            // Case 2: Clicking a specifically locked tab
            if (localLockState.lockedTabs.includes(targetTab)) {
                e.preventDefault();
                showToast("Access Denied", "This tab is locked on this device.");
                return;
            }
        }

        // Standard Navigation Logic
        const scannerVideo = document.getElementById('scanner-video');
        if (scannerVideo && scannerVideo.srcObject && button.dataset.tab !== 'scanner') {
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

// ==========================================
// SETTINGS
// ==========================================

const eventSettingsForm = document.getElementById('eventSettingsForm');
if (eventSettingsForm) {
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
}

function updateSettingsDisplay() {
    const currentEventName = document.getElementById('currentEventName');
    const currentEventPlace = document.getElementById('currentEventPlace');
    const currentDeadline = document.getElementById('currentDeadline');
    const eventNamePlace = document.getElementById('eventNamePlace');
    const eventNameInput = document.getElementById('eventName');
    const eventPlaceInput = document.getElementById('eventPlace');
    const arrivalDeadlineInput = document.getElementById('arrivalDeadline');
    const modalEventNamePlace = document.getElementById('modalEventNamePlace');

    if (currentEventName) currentEventName.textContent = eventSettings.name || 'Not set';
    if (currentEventPlace) currentEventPlace.textContent = eventSettings.place || 'Not set';
    if (currentDeadline) currentDeadline.textContent = eventSettings.deadline ? new Date(eventSettings.deadline).toLocaleString() : 'Not set';
    if (eventNamePlace) eventNamePlace.textContent = eventSettings.name && eventSettings.place ? `${eventSettings.name} | ${eventSettings.place}` : 'EVENT DETAILS';
    if (eventNameInput) eventNameInput.value = eventSettings.name || '';
    if (eventPlaceInput) eventPlaceInput.value = eventSettings.place || '';
    if (arrivalDeadlineInput) arrivalDeadlineInput.value = eventSettings.deadline || '';
    if (modalEventNamePlace) modalEventNamePlace.textContent = eventSettings.name && eventSettings.place ? `${eventSettings.name} | ${eventSettings.place}` : 'EVENT DETAILS';
}

// ==========================================
// LOCK SYSTEM FUNCTIONALITY
// ==========================================

if (lockSystemBtn) {
    lockSystemBtn.addEventListener('click', async () => {
        if (!currentUser) return;
        
        // If user is admin, show unlock modal
        if (isAdmin()) {
            if (unlockModal) {
                unlockModal.style.display = 'flex';
                if (unlockPasswordInput) unlockPasswordInput.focus();
            }
            return;
        }
        
        // Regular user lock logic
        const inputPassword = lockPasswordInput ? lockPasswordInput.value : '';
        if (!inputPassword) {
            alert("Please set a password to lock the system.");
            return;
        }

        const selectedTabs = [];
        lockCheckboxes.forEach(cb => {
            if (cb.checked) selectedTabs.push(cb.value);
        });

        // Check against Global Password (Prevent Overwrite)
        if (globalPassword && globalPassword !== inputPassword) {
            showToast("Access Denied", "Incorrect Master Password. You cannot overwrite the existing global password.");
            if (lockPasswordInput) {
                lockPasswordInput.classList.add('shake');
                setTimeout(() => lockPasswordInput.classList.remove('shake'), 500);
            }
            return;
        }

        try {
            // Only Save to DB if NO global password exists (First time setup)
            if (!globalPassword) {
                await setDoc(doc(db, APP_COLLECTION_ROOT, currentUser.uid, 'settings', 'security'), {
                    password: inputPassword
                }, { merge: true });
                
                globalPassword = inputPassword;
                showToast("Setup Complete", "Global Master Password set.");
            }
            
            // Save Lock State Locally
            localLockState = {
                isLocked: true,
                lockedTabs: selectedTabs
            };
            saveLocalSecurityState();

            // Apply UI changes immediately
            applySecurityLocks();
            
            // Force navigate away from settings to a safe tab
            const tabs = ['create', 'booked', 'scanner'];
            for (const tab of tabs) {
                if (!selectedTabs.includes(tab)) {
                    const tabBtn = document.querySelector(`[data-tab="${tab}"]`);
                    if (tabBtn) {
                        tabBtn.click();
                        break;
                    }
                }
            }

            showToast("Device Locked", "Configuration and selected tabs are now secured on this device.");

        } catch (err) {
            console.error("Lock error:", err);
            alert("Failed to process lock request.");
        }
    });
}

// ==========================================
// UNLOCK FUNCTIONALITY
// ==========================================

if (cancelUnlockBtn) {
    cancelUnlockBtn.addEventListener('click', () => {
        if (unlockModal) unlockModal.style.display = 'none';
        if (unlockPasswordInput) {
            unlockPasswordInput.value = '';
            unlockPasswordInput.classList.remove('shake');
        }
        if (unlockError) unlockError.style.display = 'none';
    });
}

if (confirmUnlockBtn) {
    confirmUnlockBtn.addEventListener('click', () => {
        const enteredPass = unlockPasswordInput ? unlockPasswordInput.value : '';
        
        // Compare against GLOBAL password synced from DB
        if (enteredPass === globalPassword) {
            // Unlock this device locally
            localLockState.isLocked = false;
            localLockState.lockedTabs = [];
            saveLocalSecurityState();
            
            applySecurityLocks();
            
            if (unlockModal) unlockModal.style.display = 'none';
            if (unlockPasswordInput) {
                unlockPasswordInput.value = '';
                unlockPasswordInput.classList.remove('shake');
            }
            if (unlockError) unlockError.style.display = 'none';
            
            // Navigate to settings
            const settingsBtn = document.querySelector('[data-tab="settings"]');
            if (settingsBtn) settingsBtn.click();
            showToast("Device Unlocked", "Access granted.");
        } else {
            if (unlockError) unlockError.style.display = 'block';
            if (unlockPasswordInput) {
                unlockPasswordInput.classList.add('shake');
                setTimeout(() => unlockPasswordInput.classList.remove('shake'), 500);
            }
        }
    });
}

// ==========================================
// AUTO ABSENT CHECK
// ==========================================

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

// ==========================================
// WHATSAPP SHARING
// ==========================================

if (document.getElementById('whatsappBtn')) {
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
                const phone = document.getElementById('ticketPhone').textContent.replace(/\D/g, '');
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
}

if (modalWhatsAppBtn) {
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
                const phone = document.getElementById('modalTicketPhone').textContent.replace(/\D/g, '');
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
}

if (closeTicketModal) {
    closeTicketModal.addEventListener('click', () => {
        if (ticketViewModal) ticketViewModal.style.display = 'none';
    });
}

// ==========================================
// SCANNER FUNCTIONALITY
// ==========================================

const startScanBtn = document.getElementById('startScanBtn');
const scannerVideo = document.getElementById('scanner-video');
const scanResult = document.getElementById('scanResult');

if (startScanBtn) {
    startScanBtn.addEventListener('click', () => {
        // Security check for locked tab
        if (localLockState.isLocked && localLockState.lockedTabs.includes('scanner')) {
            showToast("Access Denied", "Scanner tab is locked on this device.");
            return;
        }
        
        if (scannerVideo && scannerVideo.srcObject) stopScan();
        else startScan();
    });
}

function startScan() {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
            if (scannerVideo) {
                scannerVideo.srcObject = stream;
                scannerVideo.setAttribute("playsinline", true);
                scannerVideo.play();
            }
            if (startScanBtn) startScanBtn.textContent = 'Deactivate Camera';
            if (scanResult) {
                scanResult.style.display = 'block';
                scanResult.style.background = 'rgba(255,255,255,0.1)';
                scanResult.style.color = 'white';
                scanResult.textContent = 'Searching for QR Code...';
            }
            requestAnimationFrame(tick);
        }).catch(err => {
            alert("Camera error: " + err);
        });
}

function stopScan() {
    if (scannerVideo && scannerVideo.srcObject) {
        scannerVideo.srcObject.getTracks().forEach(t => t.stop());
        scannerVideo.srcObject = null;
    }
    if (startScanBtn) startScanBtn.textContent = 'Activate Camera';
}

let isCooldown = false;

function tick() {
    if (!scannerVideo || !scannerVideo.srcObject) return;
    if (scannerVideo.readyState === scannerVideo.HAVE_ENOUGH_DATA) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = scannerVideo.videoWidth;
        canvas.height = scannerVideo.videoHeight;
        ctx.drawImage(scannerVideo, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
        if (code && !isCooldown) {
            isCooldown = true;
            validateTicket(code.data);
            setTimeout(() => {
                isCooldown = false;
            }, 1500);
        }
    }
    if (scannerVideo && scannerVideo.srcObject) {
        requestAnimationFrame(tick);
    }
}

async function validateTicket(ticketId) {
    const ticket = bookedTickets.find(t => t.id === ticketId);
    if (scanResult) {
        scanResult.style.display = 'block';
        if (ticket) {
            if (ticket.status === 'coming-soon' && !ticket.scanned) {
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

// ==========================================
// SIDE CONTACT TRAY
// ==========================================

const contactTray = document.getElementById('contactTray');
const trayToggle = document.getElementById('trayToggle');
const trayIcon = document.getElementById('trayIcon');

if (trayToggle && contactTray) {
    trayToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        contactTray.classList.toggle('open');
        
        if (contactTray.classList.contains('open')) {
            if (trayIcon) {
                trayIcon.classList.remove('fa-chevron-left');
                trayIcon.classList.add('fa-chevron-right');
            }
            
            // Add Blur Effect to content
            if (appContent) appContent.classList.add('content-blur');
            const starContainer = document.getElementById('star-container');
            if (starContainer) starContainer.classList.add('content-blur');
        } else {
            if (trayIcon) {
                trayIcon.classList.remove('fa-chevron-right');
                trayIcon.classList.add('fa-chevron-left');
            }
            
            // Remove Blur Effect
            if (appContent) appContent.classList.remove('content-blur');
            const starContainer = document.getElementById('star-container');
            if (starContainer) starContainer.classList.remove('content-blur');
        }
    });

    // Close tray when clicking outside
    document.addEventListener('click', (e) => {
        if (contactTray && contactTray.classList.contains('open') && 
            !contactTray.contains(e.target) && 
            !trayToggle.contains(e.target)) {
            
            contactTray.classList.remove('open');
            if (trayIcon) {
                trayIcon.classList.remove('fa-chevron-right');
                trayIcon.classList.add('fa-chevron-left');
            }
            
            // Remove Blur Effect
            if (appContent) appContent.classList.remove('content-blur');
            const starContainer = document.getElementById('star-container');
            if (starContainer) starContainer.classList.remove('content-blur');
        }
    });
}

// ==========================================
// SERVICE WORKER
// ==========================================

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/service-worker.js").catch(err => console.log("SW failed:", err));
    });
}

// Initial update
updateOnlineStatus();
