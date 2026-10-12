# 🧪 2FA Testing Guide - Step by Step

## ✅ Quick Test (2 minutes)

### Step 1: Open the App

- Open your app in a browser
- Open **Developer Console**: Press `F12` or `Cmd+Option+J` (Mac)
- Keep it visible

### Step 2: Click "Sign in"

1. Click the **"Sign in"** button in the header
2. The **Auth Modal** should appear

### Step 3: Enter Credentials

1. **Email**: Enter any email (e.g., `test@example.com`)
2. **Password**: Enter any password (e.g., `testpass123`)
3. Click **"Sign in"** button

### Step 4: Check Console for Verification Code

- Look in the **Console tab** (should still be open from Step 1)
- You should see a **BLUE FORMATTED BOX** with:
  ```
  🔐 TRACENET AI - EMAIL VERIFICATION CODE
  Email: test@example.com
  Code: 123456
  Expires in: 10 minutes
  ```

### Step 5: Enter Verification Code

1. The modal should now show **"Verify Your Identity"** screen
2. Copy the **6-digit code** from console (e.g., `123456`)
3. Paste into the **"Verification Code"** input field
4. Click **"Verify Code"**

### Step 6: Success! ✅

- Modal should close
- You should be logged in
- The app should show your posts/data

---

## 🔍 Troubleshooting

### Problem: Console doesn't show verification code

**Solution:**

1. Make sure you're looking at the **Console tab** (not Network/Elements)
2. Try clearing console: Right-click → Select All → Delete
3. Try the sign-in flow again
4. Check if there's an error message in red

**Error Messages to Look For:**

- `❌ Error sending verification code:` → Firestore connection issue
- `Auth note (demo mode allows continuation):` → Firebase auth issue (expected)

---

### Problem: Verification screen doesn't appear

**Solution:**

1. Check if you got an error after entering credentials
2. Look for red error box in the modal
3. Make sure email is valid format (has @)
4. Try clearing browser cache and reload

---

### Problem: "Invalid verification code"

**Solution:**

1. Make sure you copied ALL 6 digits
2. Check the code hasn't expired (10 minute limit)
3. Try the "Resend Code" button to get a new code
4. Clear console first, then resend

---

## 📋 What Should Happen (Full Flow)

```
1. User clicks "Sign in" → AuthModal opens with credentials form
   ↓
2. User enters email & password → Clicks "Sign in" button
   ↓
3. Backend generates 6-digit code → Code appears in console (BLUE BOX)
   ↓
4. Modal switches to "Verify Your Identity" screen
   ↓
5. User copies code from console → Pastes into input field
   ↓
6. User clicks "Verify Code" → Code is validated
   ↓
7. Modal closes → User is now logged in ✅
```

---

## 🔧 Debug Checklist

- [ ] Verification code appears in console (check styling)
- [ ] Modal shows "Verify Your Identity" after entering credentials
- [ ] Input field accepts only 6 digits
- [ ] "Resend Code" button works
- [ ] Correct code allows verification
- [ ] Wrong code shows error message
- [ ] Modal closes after successful verification

---

## 💡 Pro Tips

**See all codes in this session:**

- Open Console and look for all blue boxes
- Each sign-in generates a new code

**Multiple Browser Windows:**

- Test in two windows - each gets its own code
- Can test if codes are email-specific

**Storage:**

- All codes stored in Firestore collection: `verification_codes`
- Each code expires in 10 minutes

---

## 🚀 Next Steps

✅ **Test is passing?** Great! 2FA is working!

- Share app with team to test
- Try real email integration from CLERK_SETUP.md

❌ **Test is failing?** Check:

- Browser console for error messages
- Firebase project is configured correctly
- Firestore has proper security rules
- Internet connection is working

---

**Need help?** Check the console logs - they have detailed info! 🔍
