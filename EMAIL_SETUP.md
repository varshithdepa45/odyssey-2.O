# 📧 Real Email Setup - SendGrid + Firebase (5 minutes)

## ✅ Step 1: Create SendGrid Account (FREE - 100 emails/day)

1. Go to https://sendgrid.com/
2. Click **"Start Free"**
3. Sign up with your email
4. Verify your email
5. You're done! ✅

---

## ✅ Step 2: Create SendGrid API Key

1. Log in to SendGrid dashboard
2. Go to **Settings → API Keys**
3. Click **"Create API Key"**
4. Select **"Restricted Access"**
5. Enable only: **"Mail Send"** permission
6. Click **"Create & Save"**
7. Copy the API key (looks like: `SG.xxx...`)
8. **SAVE IT SOMEWHERE SAFE** - you won't see it again!

---

## ✅ Step 3: Verify Your Sender Email

1. In SendGrid Dashboard → **Settings → Sender Authentication**
2. Click **"Verify a Single Sender"**
3. Enter your email (e.g., `noreply@yourdomain.com` or your Gmail)
4. Check your email for verification link
5. Click the link to verify
6. Done! ✅

---

## ✅ Step 4: Create Firebase Cloud Function

### Step 4a: Install Firebase CLI

```bash
npm install -g firebase-tools
```

### Step 4b: Set up Cloud Functions

```bash
cd /path/to/your/project
firebase init functions
# Choose: JavaScript, ESLint (yes)
```

### Step 4c: Add Code to functions/index.js

Replace the entire content with this:

```javascript
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");

// Initialize Firebase Admin
admin.initializeApp();

// Set SendGrid API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Cloud Function to send verification email
exports.sendVerificationEmail = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Email and code required" });
    }

    // Send email with SendGrid
    await sgMail.send({
      to: email,
      from: "noreply@tracenet-ai.com", // Change to your verified sender
      subject: "🔐 TraceNet AI - Email Verification",
      html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #05060f; color: #e2e8f0; padding: 30px; border-radius: 12px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #22d3ee; margin: 0;">🔐 Verify Your Email</h1>
              <p style="color: #94a3b8; margin: 5px 0 0;">TraceNet AI - Geo-Intelligent Recovery Network</p>
            </div>
            
            <p style="color: #cbd5e1; font-size: 14px; margin-bottom: 20px;">
              Welcome to TraceNet AI! Enter this code to verify your email address:
            </p>
            
            <div style="background: linear-gradient(135deg, #22d3ee 0%, #a855f7 100%); padding: 30px; border-radius: 12px; text-align: center; margin: 25px 0;">
              <div style="font-size: 48px; font-weight: bold; letter-spacing: 8px; font-family: 'Courier New', monospace; color: white;">
                ${code}
              </div>
            </div>
            
            <p style="color: #94a3b8; font-size: 12px; background: #0b0d1c; padding: 15px; border-radius: 8px; border-left: 3px solid #22d3ee;">
              ⏱️ <strong>This code expires in 10 minutes.</strong><br>
              🔒 Never share this code with anyone.<br>
              ✅ This is a one-time use code.
            </p>
            
            <p style="color: #64748b; font-size: 12px; margin-top: 20px; text-align: center; border-top: 1px solid #1e293b; padding-top: 15px;">
              Questions? Reply to this email for support.
            </p>
          </div>
        `,
    });

    return res.status(200).json({
      success: true,
      message: "Verification email sent",
    });
  } catch (error) {
    console.error("SendGrid error:", error);
    return res.status(500).json({
      error: error.message,
    });
  }
});
```

### Step 4d: Install SendGrid Package

```bash
cd functions
npm install @sendgrid/mail
```

### Step 4e: Set Environment Variable

```bash
firebase functions:config:set sendgrid.api_key="SG_YOUR_API_KEY_HERE"
```

Replace `SG_YOUR_API_KEY_HERE` with your actual SendGrid API key from Step 2.

### Step 4f: Deploy Cloud Function

```bash
firebase deploy --only functions
```

After deployment, you'll see:

```
Function URL: https://us-central1-lost-found-clg.cloudfunctions.net/sendVerificationEmail
```

---

## ✅ Step 5: Update Your App Code

Find this line in `src/app.jsx` (around line 110):

```javascript
const functionUrl =
  "https://us-central1-lost-found-clg.cloudfunctions.net/sendVerificationEmail";
```

Replace `lost-found-clg` with your **Firebase Project ID**:

1. Go to Firebase Console
2. Copy your Project ID
3. Replace in the URL

---

## ✅ Test It!

1. Open your app
2. Click **"Sign in"**
3. Enter your **real Gmail address** and password
4. Click **"Sign in"**
5. **Check your Gmail inbox** for verification email! 📧
6. Copy the code
7. Paste into the app
8. Click **"Verify Code"** ✅

---

## 🐛 Troubleshooting

### Problem: "Email service unavailable"

**Solution:**

- Check Cloud Function URL is correct in app
- Run: `firebase functions:list`
- Verify function status in Firebase Console

### Problem: Email not arriving

**Solution:**

1. Check spam folder
2. Verify sender email is verified in SendGrid
3. Check SendGrid logs: Dashboard → Activity → Email Activity
4. Check Cloud Function logs: Firebase Console → Functions → Logs

### Problem: "Access Control Allow Origin" error

**Solution:**

- Your Cloud Function should have CORS enabled (already in code above)

### Problem: SendGrid API key not working

**Solution:**

```bash
# Check env variable is set
firebase functions:config:get

# Re-set it
firebase functions:config:set sendgrid.api_key="SG_YOUR_KEY"

# Redeploy
firebase deploy --only functions
```

---

## 📊 What You Get

✅ Real emails sent to your Gmail  
✅ Beautiful branded email template  
✅ 6-digit verification codes  
✅ 10-minute code expiry  
✅ One-time use codes  
✅ 100 free emails/day from SendGrid  
✅ Production-ready setup

---

## 🚀 Next Steps

1. **Follow setup above** (takes 5 minutes)
2. **Deploy Cloud Function**
3. **Test with your Gmail**
4. **Share app with users**

---

## 💰 Pricing

- **SendGrid**: 100 free emails/day (more than enough for demos)
- **Firebase Functions**: $0.40 per million invocations (essentially free for testing)

---

## 🎉 You're Done!

Your 2FA is now **production-ready** with real emails!

Need help? Check the troubleshooting section above. ⬆️
