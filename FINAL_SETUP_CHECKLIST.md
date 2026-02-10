# 🚀 Final Setup Checklist - Synra Launch

## ✅ What's Complete:
- All code committed and pushed to GitHub
- Builds passing
- Freemium conversion flow with test queries
- Stripe integration ready
- Marketing site updated

---

## 🔧 What You Need to Do Right Now:

### 1. **Run Database Migration**

Execute this in your Supabase SQL Editor:

```sql
-- Add test_queries_used column to credentials table
ALTER TABLE credentials
ADD COLUMN test_queries_used INTEGER NOT NULL DEFAULT 0;
```

---

### 2. **Set Up Stripe Products** (5 minutes)

Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products)

**Create 3 Products:**

1. **Synra - Starter** ($19/month recurring)
   - Copy the **Price ID** → `price_...`
   
2. **Synra - Pro** ($99/month recurring)
   - Copy the **Price ID** → `price_...`
   
3. **Synra - Team** ($299/month recurring)
   - Copy the **Price ID** → `price_...`

---

### 3. **Set Up Stripe Webhook** (3 minutes)

Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)

1. Click **"Add endpoint"**
2. URL: `https://app.mcpserver.design/api/stripe/webhook`
3. Select these 5 events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Save and copy the **Signing Secret** → `whsec_...`

---

### 4. **Update `.env.local`** (Local Testing)

Add to `/Users/sam/Documents/MCPServer/synra-app/.env.local`:

```env
# Stripe (ADD THESE)
STRIPE_SECRET_KEY=sk_live_...your_secret_key...
STRIPE_WEBHOOK_SECRET=whsec_...from_webhook_setup...
STRIPE_PRICE_ID_STARTER=price_...starter_19_dollar...
STRIPE_PRICE_ID_PRO=price_...pro_99_dollar...
STRIPE_PRICE_ID_TEAM=price_...team_299_dollar...
```

---

### 5. **Deploy to Railway** (3 minutes)

```bash
cd synra-app

# Set all Stripe variables
railway variables set STRIPE_SECRET_KEY=sk_live_...
railway variables set STRIPE_WEBHOOK_SECRET=whsec_...
railway variables set STRIPE_PRICE_ID_STARTER=price_...
railway variables set STRIPE_PRICE_ID_PRO=price_...
railway variables set STRIPE_PRICE_ID_TEAM=price_...

# Trigger redeploy (Railway auto-deploys from GitHub)
# Or manually trigger in Railway dashboard
```

---

### 6. **Deploy Marketing Site** (Auto)

Netlify should auto-deploy the latest changes from GitHub.

Check: [Netlify Dashboard](https://app.netlify.com)

---

## 🧪 Test the Complete Flow:

### **A. Test Freemium Conversion:**
1. Go to `https://app.mcpserver.design/login`
2. Sign up with new account
3. Add a Supabase credential
4. **Verify:**
   - ✅ URL is blurred
   - ✅ "Test Connection" button shows (3 queries remaining)
   - ✅ Click test → see tables listed
   - ✅ Counter decrements (2 queries remaining)
   - ✅ After 3 tests → "Subscribe to unlock" button
5. Click "Subscribe $19/mo"
6. Complete Stripe checkout (use real card for live mode)
7. **Verify:**
   - ✅ URL is revealed
   - ✅ Copy button works
   - ✅ No more test query limit

### **B. Test MCP Gateway:**
1. Copy the unlocked MCP endpoint URL
2. Add to Claude Desktop config:
```json
{
  "mcpServers": {
    "synra": {
      "url": "https://app.mcpserver.design/api/mcp/YOUR_ENDPOINT_ID"
    }
  }
}
```
3. Restart Claude
4. Ask: "List all tables in my database"
5. Ask: "Show me the first 5 rows from [table_name]"

### **C. Test Billing:**
1. Go to Settings → Click "Manage Billing"
2. Update payment method
3. Cancel subscription → verify downgrade
4. Resubscribe → verify upgrade

---

## 📊 What Happens in the Conversion Flow:

### **Unpaid User (First 3 Queries Free):**
```
Sign Up → Add Credential
   ↓
See Blurred URL + "Test Connection" (3 free)
   ↓
Click Test → See Tables Listed → "It Works!" ✅
   ↓
Try 3 Times → Counter: 3... 2... 1... 0
   ↓
"Subscribe to Unlock Full Access" ($19/mo)
   ↓
Click → Stripe Checkout
```

### **Paid User (After $19/mo):**
```
Complete Payment
   ↓
URL Revealed + Copy Button
   ↓
Unlimited Queries
   ↓
Full Dashboard Access
```

---

## 🎯 Success Metrics to Watch:

1. **Sign up → Test Connection** conversion
2. **Test Connection → Subscribe** conversion
3. **Subscribe → Active MCP Usage** (do they actually use it?)
4. **Starter → Pro** upgrade rate

---

## ⚡ Current Status:

✅ Code complete and committed  
✅ Builds passing  
⏳ Need to add Stripe products  
⏳ Need to add Stripe webhook  
⏳ Need to run database migration  
⏳ Need to deploy with env vars  

**Estimated time to launch:** 15-20 minutes 🚀

---

## 🆘 If Something Breaks:

### Stripe webhook not working:
- Check signing secret is correct
- Verify URL is publicly accessible
- Check webhook logs in Stripe Dashboard

### Test queries not working:
- Verify `test_queries_used` column exists in database
- Check `/api/test-connection` logs

### URL still blurred after payment:
- Check `stripe_subscription_id` exists in subscriptions table
- Verify subscription `status` is 'active'
- Check browser console for errors

---

**You're ready to launch!** 🎉
