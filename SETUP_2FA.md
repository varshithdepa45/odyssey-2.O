# 📧 EmailJS Setup - 5 Minutes (SUPER EASY)

## 🎯 What You Need to Do

Just 3 steps to get real emails working!

---

## Step 1️⃣: Create FREE EmailJS Account (2 min)

1. Go to **https://www.emailjs.com/**
2. Click **"Sign Up Free"** (top right)
3. Use your Gmail to sign up
4. Check your email for verification link
5. Click the link ✅
6. Done!

---

## Step 2️⃣: Connect Your Gmail (2 min)

1. Login to EmailJS
2. Go to **"Email Services"** (left menu)
3. Click **"Add Service"**
4. Select **"Gmail"**
5. Click **"Connect with Google"**
6. Allow EmailJS to access Gmail
7. Copy the **Service ID** (looks like `service_xxx`)
8. Keep this open! You'll need it in a moment

---

## Step 3️⃣: Create Email Template (1 min)

1. Go to **"Email Templates"** (left menu)
2. Click **"Create New Template"**
3. Name it: `verification_code` or whatever
4. In the template, replace content with this:

```
Subject: 🔐 {{user_email}} - Verification Code

Body (HTML):
<div style="font-family: Arial; max-width: 500px; margin: 0 auto; background: #05060f; color: #e2e8f0; padding: 30px; border-radius: 12px;">
  <h1 style="color: #22d3ee; text-align: center;">🔐 Verify Your Email</h1>
  <p>Your verification code:</p>
  <div style="background: linear-gradient(135deg, #22d3ee 0%, #a855f7 100%); padding: 30px; border-radius: 12px; text-align: center; margin: 25px 0;">
    <div style="font-size: 48px; font-weight: bold; letter-spacing: 8px; font-family: monospace; color: white;">
      {{verification_code}}
    </div>
  </div>
  <p style="color: #94a3b8; font-size: 12px;">⏱️ Code expires in 10 minutes.</p>
</div>
```

5. Click **"Save"**
6. Copy the **Template ID** (top of template)
7. Keep it!

---

## Step 4️⃣: Get Your Public Key (1 min)

1. Go to **"Account"** (left menu) → **"API Keys"**
2. Copy your **Public Key** (looks like `xxx_yyy_zzz`)
3. Keep it safe!

---

## Step 5️⃣: Update Your App (1 min)

Open `/Users/varshithreddy/Desktop/Tracenet-ai/src/app.jsx`

Find this section (around line 57):

```javascript
const EMAILJS_SERVICE_ID = "service_tracenet"; // You'll get this from EmailJS
const EMAILJS_TEMPLATE_ID = "template_tracenet"; // You'll get this from EmailJS
const EMAILJS_PUBLIC_KEY = "YOUR_PUBLIC_KEY_HERE"; // Get from EmailJS
```

Replace with YOUR values from EmailJS:

```javascript
const EMAILJS_SERVICE_ID = "service_abc123def456"; // Your Service ID
const EMAILJS_TEMPLATE_ID = "template_xyz789"; // Your Template ID
const EMAILJS_PUBLIC_KEY = "your_public_key_here"; // Your Public Key
```

Save the file!

---

## ✅ Done! Test It!

1. Reload your app in browser
2. Click **"Sign in"**
3. Enter your **real Gmail** and any password
4. Click **"Sign in"**
5. **Check your Gmail inbox** 📧
6. You should see email with 6-digit code!
7. Copy code
8. Paste into app
9. Click **"Verify Code"**
10. ✅ **You're logged in!**

---

## 🎉 That's It!

Your 2FA is now **fully working with real emails**!

- ✅ Users receive codes in their inbox
- ✅ 6-digit verification codes
- ✅ 10-minute expiry
- ✅ One-time use
- ✅ Beautiful email template
- ✅ 200 free emails/month
- ✅ No backend setup needed!

---

## 🐛 Troubleshooting

**Email not arriving?**

- Check spam folder
- Make sure you verified your Gmail in EmailJS (Step 2)
- Check EmailJS dashboard → Email Activity to see if it tried to send

**App says "Email service unavailable"?**

- Check your Public Key is correct (no spaces)
- Check Service ID and Template ID are correct
- Reload the page

**Check if it's working:**

- Open browser Console (F12)
- Look for `✅ EmailJS initialized` message
- Should appear when page loads

---

## 📊 EmailJS Free Tier

- ✅ 200 emails/month (plenty!)
- ✅ Unlimited templates
- ✅ Full email tracking
- ✅ No credit card needed
- ✅ Free forever for basic use

---

## Need Help?

- EmailJS docs: https://www.emailjs.com/docs/
- Contact: support@emailjs.com

**You're all set! Enjoy your 2FA! 🚀**
