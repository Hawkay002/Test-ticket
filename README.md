# 🎫 Event Ticketing System (Midnight Edition)

A high-end, real-time event management dashboard featuring a glass-like UI, secure cloud sync, and intelligent QR entry validation.

---

## 📚 Table of Contents

1. [Overview](#overview)
2. [Key Features](#key-features)

   * [Smart Ticket Issuance](#smart-ticket-issuance)
   * [Advanced Entry Scanner](#advanced-entry-scanner)
   * [Responsive & Robust](#responsive--robust)
3. [Installation & Setup](#installation--setup)
4. [How to Use](#how-to-use)

   * [Dashboard (Desk Agent)](#1-the-dashboard-desk-agent)
   * [Scanner (Security Team)](#2-the-scanner-security-team)
   * [Management](#3-management)
5. [Project Structure](#project-structure)
6. [Security](#security)
7. [License](#license)

---

## 📖 Overview

This is a serverless, single-file web app designed for exclusive events. It replaces messy spreadsheets with a modern, dark-themed dashboard that runs in any browser.

**Why it stands out:**

* ✨ Premium aesthetics: "Midnight Void" dark theme with glass-like panels and the 'Outfit' font.
* ⚡ Real-time cloud sync using Firebase Firestore.
* 🔒 Admin-only access with strict authentication.

---

## ✨ Key Features

### 🎟️ Smart Ticket Issuance

* Creates a sharp, holographic-style digital pass.
* One-tap WhatsApp workflow:

  * Generates the ticket image.
  * Auto-downloads to device.
  * Opens WhatsApp with a ready-to-send message.
  * Resets form instantly for quick entry.

### 📸 Advanced Entry Scanner

* Works directly through the browser camera.
* Audio feedback system:

  * **Success:** Positive beep.
  * **Error:** Buzzer for invalid or duplicate scans.
* Marks guests as "Arrived" instantly and syncs across all devices.

### 📱 Responsive & Robust

* Smooth on laptops for desk agents.
* Fast and reliable on phones for security.

---

## 🛠️ Installation & Setup

### Prerequisites

* A Google/Firebase account
* A GitHub account

### Step 1: Clone the Repository

```bash
git clone https://github.com/Hawkay002/Ticket-backend.git
cd Ticket-backend
```

### Step 2: Firebase Configuration

* Open Firebase Console
* Create a project + register a Web App (</>)
* Firestore Database → Create in Test Mode
* Auth → Enable Email/Password
* Users → Add admin email + password manually

Registration is intentionally disabled for security.

### Step 3: Link Firebase Keys

Open **index.html** and update:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  // ...rest
};
```

### Step 4: Add Custom Sounds (Optional)

Place these files next to **index.html**:

* `success.mp3`
* `error.mp3`

If not present, the system uses built-in electronic tones.

---

## 🚀 How to Use

### 1. The Dashboard (Desk Agent)

* Log in with admin credentials
* Go to **Issue Ticket**
* Enter details: Name, Age, Phone
* Click **Generate Pass**
* Then **Save & Share via WhatsApp**

### 2. The Scanner (Security Team)

* Log in on mobile
* Open **Scanner** tab
* Tap **Activate Camera**
* Scan QR:

  * **Green + Beep:** Valid
  * **Red + Buzzer:** Invalid / Already scanned

### 3. Management

* Open **Guest List** for live stats
* Use **Configuration** to update event name/location

---

## 📂 Project Structure

```
Ticket-backend/
├── index.html       # Main app (HTML + CSS + JS)
├── success.mp3      # Optional sound
├── error.mp3        # Optional sound
└── README.md        # Documentation
```

---

## 🛡️ Security

* Only manually added accounts can log in
* No public sign-up
* Data stored in isolated Firestore collections

---

## 📄 License

MIT License
