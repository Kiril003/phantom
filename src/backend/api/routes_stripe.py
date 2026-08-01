import os
from fastapi import APIRouter, Request, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.database import get_db
from db.models import Subscription
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stripe", tags=["stripe"])

# In a real environment, this would be a secure webhook secret from Stripe
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

@router.post("/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    # In a real app, we would use the `stripe` python package to verify the signature:
    # try:
    #     event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    # except ValueError as e:
    #     raise HTTPException(status_code=400, detail="Invalid payload")
    # except stripe.error.SignatureVerificationError as e:
    #     raise HTTPException(status_code=400, detail="Invalid signature")
    
    # For this prototype, we'll parse the JSON payload directly
    import json
    try:
        event = json.loads(payload.decode('utf-8'))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = event.get("type")
    
    if event_type == "checkout.session.completed":
        session = event.get("data", {}).get("object", {})
        customer_id = session.get("customer")
        
        if customer_id:
            # Find the subscription for this customer
            result = await db.execute(select(Subscription).where(Subscription.stripe_customer_id == customer_id))
            subscription = result.scalar_one_or_none()
            
            if subscription:
                # Upgrade logic: set tier to Pro and bump max tokens
                subscription.tier = "Pro"
                subscription.max_tokens = 1000000  # 1M tokens for Pro
                db.add(subscription)
                await db.commit()
                logger.info(f"Upgraded subscription for customer {customer_id}")
                
    elif event_type == "customer.subscription.deleted":
        subscription_obj = event.get("data", {}).get("object", {})
        customer_id = subscription_obj.get("customer")
        
        if customer_id:
            result = await db.execute(select(Subscription).where(Subscription.stripe_customer_id == customer_id))
            subscription = result.scalar_one_or_none()
            
            if subscription:
                # Downgrade logic: return to Free tier
                subscription.tier = "Free"
                subscription.max_tokens = 1000
                db.add(subscription)
                await db.commit()
                logger.info(f"Downgraded subscription for customer {customer_id}")

    return {"status": "success"}

@router.post("/create-checkout-session")
async def create_checkout_session(tenant_id: str):
    # In a real app, this would use the `stripe` package to create a session:
    # session = stripe.checkout.Session.create(
    #     customer=stripe_customer_id,
    #     payment_method_types=['card'],
    #     line_items=[{
    #         'price': 'price_12345',
    #         'quantity': 1,
    #     }],
    #     mode='subscription',
    #     success_url='https://example.com/success',
    #     cancel_url='https://example.com/cancel',
    # )
    # return {"url": session.url}
    
    # Mocking the response for the prototype
    return {"url": "https://billing.stripe.com/p/session/test_mock_session"}
