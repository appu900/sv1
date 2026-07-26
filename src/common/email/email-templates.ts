import { buildEmailDeepLink } from './app-deep-links';

const LIGHT_MODE_META = `
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">`;

const LOGO_BLOCK = `
<!-- Light mode logo -->
<img
  src="https://cdn.saveful.app/logo%403x.png"
  alt="Saveful logo"
  width="110"
  class="logo logo-light"
/>
<!-- Dark mode logo -->
<img
  src="https://cdn.saveful.app/Saveful-logo-white-Rev.webp"
  alt="Saveful logo"
  width="110"
  class="logo logo-dark"
/>`;

const FOOTER = `<tr><td class="footer" bgcolor="#ffffff" style="background-color:#ffffff;">© Saveful Worldwide Pty Ltd, <a href="https://www.saveful.com" style="color:inherit; text-decoration:underline;">Saveful.com</a></td></tr>`;

const DARK_LOGO_MEDIA = `
  @media (prefers-color-scheme: dark) {
    .logo-light { display: none !important; }
    .logo-dark  { display: block !important; }
  }`;

export function otpTemplate(otpCode: string, expiryMinutes: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${LIGHT_MODE_META}
<title>Your Saveful verification code</title>
<style>
  :root { color-scheme: light; supported-color-schemes: light; }
  body { margin:0; padding:0; background-color:#f6f3fb !important; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; color:#2b1e44 !important; }
  table, td { border-collapse:collapse; background-color:#f6f3fb !important; }
  img { display:block; border:0; }
  .container { max-width:600px; background-color:#ffffff !important; border-radius:16px; overflow:hidden; }
  .content { padding:32px 28px; text-align:center; background-color:#ffffff !important; }
  h1 { font-size:22px; margin:0 0 12px; font-weight:700; color:#2b1e44 !important; }
  p { font-size:15px; line-height:1.6; margin:0 0 16px; color:#3d3558 !important; }
  .otp-box { background-color:#f3efff !important; border-radius:12px; padding:20px 0; font-size:30px; font-weight:700; letter-spacing:6px; color:#2b1e44 !important; width:100%; max-width:320px; margin:28px auto 16px; }
  .hint { font-size:13px; color:#7a7391 !important; }
  .divider { height:1px; background-color:#eeeaf7 !important; margin:28px 0; }
  .logo { margin:24px auto 0; width:110px; }
  .logo-light { display:block; }
  .logo-dark { display:none; }
  .footer { padding:22px; font-size:13px; color:#7a7391 !important; background-color:#ffffff !important; text-align:center; }
  ${DARK_LOGO_MEDIA}
  @media (max-width:480px) { .content { padding:26px 18px; } h1 { font-size:20px; } p { font-size:14px; } .otp-box { font-size:26px; letter-spacing:4px; } }
</style>
</head>
<body bgcolor="#f6f3fb" style="background-color:#f6f3fb;">
<table width="100%" bgcolor="#f6f3fb" style="background-color:#f6f3fb;" role="presentation">
<tr><td align="center" bgcolor="#f6f3fb" style="background-color:#f6f3fb; padding:16px;">
<table class="container" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;" role="presentation">
<tr><td class="content" bgcolor="#ffffff" style="background-color:#ffffff;">
<h1>Verify your email</h1>
<p>Welcome to Saveful.<br/>Use the verification code below to complete your sign-up.</p>
<div class="otp-box">${otpCode}</div>
<p class="hint">This code expires in ${expiryMinutes} minutes.</p>
<div class="divider"></div>
<p style="margin-bottom:0;">If you didn't request this, you can safely ignore this email.</p>
${LOGO_BLOCK}
</td></tr>
${FOOTER}
</table>
</td></tr>
</table>
</body>
</html>`;
}


export function welcomeTemplate(userName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to Saveful</title>
<style>
  body { margin:0; padding:0; background-color:#f6f3fb; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; color:#2b1e44; }
  table { border-collapse:collapse; }
  img { display:block; border:0; }
  .wrapper { width:100%; padding:20px 12px; }
  .container { max-width:600px; margin:0 auto; background-color:#ffffff; border-radius:18px; overflow:hidden; }
  .content { padding:36px 32px 32px; }
  h1 { font-size:24px; line-height:1.3; margin:0 0 14px; font-weight:700; color:#241a3d; }
  .intro { font-size:16px; line-height:1.7; margin-bottom:22px; color:#3d3558; }
  .card { background-color:#faf8ff; border-radius:14px; padding:20px 18px; margin:22px 0; }
  .feature-row { font-size:15px; line-height:1.6; padding:8px 0; color:#3d3558; }
  .cta { text-align:center; margin:30px 0 26px; }
  .cta a { background-color:#7b5cff; color:#ffffff; text-decoration:none; padding:16px 28px; border-radius:12px; font-weight:600; font-size:15px; display:inline-block; }
  .soft { font-size:15px; line-height:1.6; color:#4a4366; margin-bottom:14px; }
  .signoff { margin-top:28px; font-size:15px; color:#3d3558; }
  .logo { margin:26px auto 0; width:110px; }
  .logo-light { display:block; }
  .logo-dark { display:none; }
  .footer { padding:22px; font-size:13px; color:#7a7391; text-align:center; }
  ${DARK_LOGO_MEDIA}
  @media (max-width:480px) { .content { padding:28px 20px; } h1 { font-size:21px; } .intro { font-size:15px; } .cta a { padding:14px 22px; } }
</style>
</head>
<body>
  <table class="wrapper" width="100%" role="presentation">
    <tr><td align="center">
      <table class="container" width="100%" role="presentation">
        <tr><td><img src="https://cdn.saveful.app/header.jpeg" alt="Welcome to Saveful" width="600" style="width:100%; max-width:600px;" /></td></tr>
        <tr><td class="content">
          <h1>Welcome to Saveful</h1>
          <p class="intro">Here's the good news. You can save money on groceries without changing how you cook.</p>
          <p class="soft">Saveful helps you use the food you already have - in your fridge, freezer, and pantry - so you buy less, waste less, and still eat well.</p>
          <div class="card">
            <div class="feature-row">• No strict recipes</div>
            <div class="feature-row">• No budgeting</div>
            <div class="feature-row">• No pressure</div>
          </div>
          <p class="soft">If you've got <strong>60 seconds</strong>, that's all you need to get started.</p>
          <div class="cta"><a href="${buildEmailDeepLink('inventory')}">Open Saveful and add what's in your fridge</a></div>
          <p class="soft">Saveful helps you save money, save food, and save time - using what you already have.</p>
          <p class="signoff">With Saveful, you've got this.<br>- The Saveful Team</p>
          ${LOGO_BLOCK}
        </td></tr>
        <tr><td class="footer">You're receiving this email because you signed up for Saveful.<br>© Saveful Worldwide Pty Ltd, <a href="https://www.saveful.com" style="color:inherit; text-decoration:underline;">Saveful.com</a></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function passwordResetTemplate(otpCode: string, expiryMinutes: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${LIGHT_MODE_META}
<title>Reset your Saveful password</title>
<style>
  :root { color-scheme: light; supported-color-schemes: light; }
  body { margin:0; padding:0; background-color:#f6f3fb !important; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; color:#2b1e44 !important; }
  table, td { border-collapse:collapse; background-color:#f6f3fb !important; }
  img { display:block; border:0; }
  .container { max-width:600px; background-color:#ffffff !important; border-radius:16px; overflow:hidden; }
  .content { padding:32px 28px; text-align:center; background-color:#ffffff !important; }
  h1 { font-size:22px; margin:0 0 12px; font-weight:700; color:#2b1e44 !important; }
  p { font-size:15px; line-height:1.6; margin:0 0 16px; color:#3d3558 !important; }
  .otp-box { background-color:#fff4ec !important; border-radius:12px; padding:20px 0; font-size:30px; font-weight:700; letter-spacing:6px; color:#F7931E !important; width:100%; max-width:320px; margin:28px auto 16px; }
  .hint { font-size:13px; color:#7a7391 !important; }
  .divider { height:1px; background-color:#eeeaf7 !important; margin:28px 0; }
  .logo { margin:24px auto 0; width:110px; }
  .logo-light { display:block; }
  .logo-dark { display:none; }
  .footer { padding:22px; font-size:13px; color:#7a7391 !important; background-color:#ffffff !important; text-align:center; }
  ${DARK_LOGO_MEDIA}
  @media (max-width:480px) { .content { padding:26px 18px; } h1 { font-size:20px; } .otp-box { font-size:26px; letter-spacing:4px; } }
</style>
</head>
<body bgcolor="#f6f3fb" style="background-color:#f6f3fb;">
<table width="100%" bgcolor="#f6f3fb" style="background-color:#f6f3fb;" role="presentation">
<tr><td align="center" bgcolor="#f6f3fb" style="background-color:#f6f3fb; padding:16px;">
<table class="container" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;" role="presentation">
<tr><td class="content" bgcolor="#ffffff" style="background-color:#ffffff;">
<h1>Reset your password</h1>
<p>We received a request to reset your Saveful account password.<br/>Use the code below to set a new password.</p>
<div class="otp-box">${otpCode}</div>
<p class="hint">This code expires in ${expiryMinutes} minutes.</p>
<div class="divider"></div>
<p style="margin-bottom:0;">If you didn't request a password reset, you can safely ignore this email.</p>
${LOGO_BLOCK}
</td></tr>
${FOOTER}
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function accountDeletionTemplate(userName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${LIGHT_MODE_META}
<title>Your Saveful Account Has Been Deleted</title>
<style>
  :root { color-scheme: light; supported-color-schemes: light; }
  body { margin:0; padding:0; background-color:#f6f3fb !important; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; color:#2b1e44 !important; }
  table, td { border-collapse:collapse; background-color:#f6f3fb !important; }
  img { display:block; border:0; }
  .container { max-width:600px; background-color:#ffffff !important; border-radius:16px; overflow:hidden; }
  .content { padding:36px 32px 32px; background-color:#ffffff !important; }
  h1 { font-size:22px; margin:0 0 14px; font-weight:700; color:#2b1e44 !important; }
  p { font-size:15px; line-height:1.6; margin:0 0 16px; color:#3d3558 !important; }
  .notice-box { background-color:#fff4ec !important; border-left:4px solid #F7931E; border-radius:8px; padding:16px 18px; margin:22px 0; }
  .notice-box p { margin:0; font-size:14px; color:#3d3558 !important; }
  .divider { height:1px; background-color:#eeeaf7 !important; margin:28px 0; }
  .logo { margin:24px auto 0; width:110px; }
  .logo-light { display:block; }
  .logo-dark { display:none; }
  .footer { padding:22px; font-size:13px; color:#7a7391 !important; background-color:#ffffff !important; text-align:center; }
  ${DARK_LOGO_MEDIA}
  @media (max-width:480px) { .content { padding:26px 18px; } h1 { font-size:20px; } }
</style>
</head>
<body bgcolor="#f6f3fb" style="background-color:#f6f3fb;">
<table width="100%" bgcolor="#f6f3fb" style="background-color:#f6f3fb;" role="presentation">
<tr><td align="center" bgcolor="#f6f3fb" style="background-color:#f6f3fb; padding:16px;">
<table class="container" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;" role="presentation">
<tr><td class="content" bgcolor="#ffffff" style="background-color:#ffffff;">
<h1>Your account has been deleted</h1>
<p>Hi ${userName},</p>
<p>Your Saveful account and all associated data have been permanently deleted as requested. We're sorry to see you go.</p>
<div class="notice-box"><p>Your email address, profile, and all app data have been removed from our systems.</p></div>
<p>If you believe this was a mistake or didn't make this request, please contact our support team immediately at <a href="https://www.saveful.com/contact" style="color:#7b5cff;">saveful.com/contact</a>.</p>
<p>We hope to see you again someday. You're always welcome to create a new account.</p>
<p style="margin-bottom:0;">- The Saveful Team</p>
<div class="divider"></div>
${LOGO_BLOCK}
</td></tr>
${FOOTER}
</table>
</td></tr>
</table>
</body>
</html>`;
}
