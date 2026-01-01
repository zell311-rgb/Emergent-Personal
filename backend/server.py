import os
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Literal, Optional, Tuple

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

load_dotenv()

APP_TITLE = "2026 Accountability Tracker"

# -----------------------------
# Helpers
# -----------------------------

def now_utc() -> datetime:
    return datetime.utcnow()


def iso_date(d: date) -> str:
    return d.isoformat()


def parse_date(s: str) -> date:
    try:
        return date.fromisoformat(s)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {s}. Use YYYY-MM-DD") from e


def new_id() -> str:
    return str(uuid.uuid4())


def clamp_float(v: float, min_v: float, max_v: float, label: str) -> float:
    if v < min_v or v > max_v:
        raise HTTPException(status_code=400, detail=f"{label} out of range")
    return v


# -----------------------------
# Models
# -----------------------------

class CheckInUpsertRequest(BaseModel):
    day: str = Field(..., description="YYYY-MM-DD")
    wakeup_5am: bool
    workout: bool
    video_captured: bool
    notes: Optional[str] = ""


class CheckIn(BaseModel):
    id: str
    day: str
    wakeup_5am: bool
    workout: bool
    video_captured: bool
    notes: str = ""
    created_at: str
    updated_at: str


class WeightEntryCreate(BaseModel):
    day: str
    weight_lbs: float


class BodyFatEntryCreate(BaseModel):
    day: str
    body_fat_pct: float


class WaistEntryCreate(BaseModel):
    # Backwards compatibility (deprecated): old field name
    day: str
    waist_in: float


class MetricEntry(BaseModel):
    id: str
    day: str
    kind: Literal["weight", "body_fat", "waist"]
    value: float
    created_at: str


class PhotoEntry(BaseModel):
    id: str
    day: str
    filename: str
    url: str
    created_at: str


class PrincipalPaymentCreate(BaseModel):
    day: str
    amount: float
    note: Optional[str] = ""


class BalanceCheckCreate(BaseModel):
    day: str
    principal_balance: float
    note: Optional[str] = ""


class MortgageEvent(BaseModel):
    id: str
    day: str
    kind: Literal["principal_payment", "balance_check"]
    amount: float
    note: str = ""
    created_at: str


class TripUpdate(BaseModel):
    # structured dates (preferred)
    start_date: Optional[str] = ""  # YYYY-MM-DD
    end_date: Optional[str] = ""  # YYYY-MM-DD

    # legacy/freeform dates (kept for backwards-compat)
    dates: Optional[str] = ""

    adults_only: bool = True
    lodging_booked: bool = False
    childcare_confirmed: bool = False
    notes: Optional[str] = ""


class TripState(BaseModel):
    id: str

    start_date: str = ""
    end_date: str = ""
    dates: str = ""  # legacy

    adults_only: bool = True
    lodging_booked: bool = False
    childcare_confirmed: bool = False
    notes: str = ""
    updated_at: str = ""


class TripHistoryEntry(BaseModel):
    id: str
    trip_id: str
    created_at: str
    snapshot: TripState


class GiftCreate(BaseModel):
    day: str
    description: str
    amount: Optional[float] = 0


class GiftEntry(BaseModel):
    id: str
    day: str
    description: str
    amount: float
    created_at: str


class SettingsUpdate(BaseModel):
    # email
    sendgrid_api_key: Optional[str] = ""
    sendgrid_sender_email: Optional[str] = ""
    reminder_recipient_email: Optional[str] = ""
    weekly_review_day: Literal["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] = "Sun"
    weekly_review_hour_local: int = 9
    monthly_gift_day: int = 1
    email_enabled: bool = False


class SettingsResponse(BaseModel):
    id: str
    sendgrid_sender_email: str = ""
    reminder_recipient_email: str = ""
    weekly_review_day: str
    weekly_review_hour_local: int
    monthly_gift_day: int
    email_enabled: bool
    updated_at: str


class SummaryResponse(BaseModel):
    today: str
    # streaks and weekly adherence
    current_wakeup_streak: int
    current_workout_streak: int
    week_wakeup_count: int
    week_workout_count: int
    week_video_count: int
    # fitness
    latest_weight_lbs: Optional[float] = None
    latest_body_fat_pct: Optional[float] = None
    # mortgage
    mortgage_target_principal: float
    mortgage_start_principal: float
    latest_principal_balance: Optional[float] = None
    principal_paid_extra_ytd: float
    principal_paid_extra_month: float
    # relationship
    trip_lodging_booked: bool
    trip_childcare_confirmed: bool
    gifts_this_month: int
    # reminders
    reminders: List[Dict[str, Any]]


class WeeklyReviewResponse(BaseModel):
    week_start: str
    week_end: str
    wakeups_ge_4: bool
    workouts_completed_5: bool
    captured_at_least_1_video: bool
    mortgage_action_taken: bool
    relationship_action_taken: bool


# -----------------------------
# App + DB
# -----------------------------

app = FastAPI(title=APP_TITLE)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

MONGO_URL = os.environ.get("MONGO_URL")
if not MONGO_URL:
    # This should be set via backend/.env in this environment.
    raise RuntimeError("MONGO_URL is not set")

mongo_client: Optional[AsyncIOMotorClient] = None
mongo_db = None

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Serve uploaded progress photos
app.mount("/api/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Locked plan constants
MORTGAGE_START_PRINCIPAL = 330000.0
MORTGAGE_TARGET_PRINCIPAL = 299999.0


@app.on_event("startup")
async def on_startup() -> None:
    global mongo_client, mongo_db
    mongo_client = AsyncIOMotorClient(MONGO_URL)
    mongo_db = mongo_client.get_default_database()  # from URI path

    # Ensure baseline settings doc exists
    await mongo_db.settings.update_one(
        {"_id": "default"},
        {"$setOnInsert": {"_id": "default", "updated_at": now_utc().isoformat()}},
        upsert=True,
    )

    # Ensure baseline trip doc exists
    await mongo_db.trip.update_one(
        {"_id": "default"},
        {
            "$setOnInsert": {
                "_id": "default",
                "start_date": "",
                "end_date": "",
                "dates": "",
                "adults_only": True,
                "lodging_booked": False,
                "childcare_confirmed": False,
                "notes": "",
                "updated_at": now_utc().isoformat(),
            }
        },
        upsert=True,
    )

    # Basic indexes
    await mongo_db.checkins.create_index("day", unique=True)
    await mongo_db.metrics.create_index([("day", 1), ("kind", 1)])
    await mongo_db.mortgage_events.create_index([("day", 1), ("kind", 1)])
    await mongo_db.gifts.create_index("day")
    await mongo_db.trip_history.create_index([("trip_id", 1), ("created_at", -1)])


@app.on_event("shutdown")
async def on_shutdown() -> None:
    global mongo_client
    if mongo_client is not None:
        mongo_client.close()


@app.get("/api/health")
async def health() -> Dict[str, Any]:
    return {"status": "ok", "app": APP_TITLE}


@app.post("/api/admin/reset")
async def admin_reset(confirm: str = Query(..., description="Must be 'RESET'")) -> Dict[str, Any]:
    """Dangerous: wipes all user-entered data for this single-user MVP.

    Notes:
    - Does not delete the settings doc (so SendGrid config stays).
    - Does not delete uploaded photo files on disk (only removes DB references).
    """
    if confirm != "RESET":
        raise HTTPException(status_code=400, detail="confirm must be 'RESET'")

    collections_to_clear = [
        "checkins",
        "metrics",
        "photos",
        "mortgage_events",
        "gifts",
        "trip_history",
    ]

    deleted = {}
    for c in collections_to_clear:
        res = await mongo_db[c].delete_many({})
        deleted[c] = res.deleted_count

    # reset trip to defaults
    await mongo_db.trip.update_one(
        {"_id": "default"},
        {
            "$set": {
                "start_date": "",
                "end_date": "",
                "dates": "",
                "adults_only": True,
                "lodging_booked": False,
                "childcare_confirmed": False,
                "notes": "",
                "updated_at": now_utc().isoformat(),
            }
        },
        upsert=True,
    )

    return {
        "ok": True,
        "deleted": deleted,
        "note": "Settings kept. Photo files on disk not deleted (DB entries cleared).",
    }


# -----------------------------
# Check-ins
# -----------------------------

@app.post("/api/checkins/upsert", response_model=CheckIn)
async def upsert_checkin(payload: CheckInUpsertRequest) -> CheckIn:
    d = parse_date(payload.day)
    ts = now_utc().isoformat()

    existing = await mongo_db.checkins.find_one({"day": iso_date(d)})
    if existing:
        await mongo_db.checkins.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "wakeup_5am": payload.wakeup_5am,
                    "workout": payload.workout,
                    "video_captured": payload.video_captured,
                    "notes": payload.notes or "",
                    "updated_at": ts,
                }
            },
        )
        doc = await mongo_db.checkins.find_one({"_id": existing["_id"]})
    else:
        _id = new_id()
        doc_in = {
            "_id": _id,
            "day": iso_date(d),
            "wakeup_5am": payload.wakeup_5am,
            "workout": payload.workout,
            "video_captured": payload.video_captured,
            "notes": payload.notes or "",
            "created_at": ts,
            "updated_at": ts,
        }
        await mongo_db.checkins.insert_one(doc_in)
        doc = doc_in

    return CheckIn(
        id=doc["_id"],
        day=doc["day"],
        wakeup_5am=doc["wakeup_5am"],
        workout=doc["workout"],
        video_captured=doc["video_captured"],
        notes=doc.get("notes", ""),
        created_at=doc.get("created_at", ts),
        updated_at=doc.get("updated_at", ts),
    )


@app.get("/api/checkins", response_model=List[CheckIn])
async def list_checkins(
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str = Query(..., description="YYYY-MM-DD"),
) -> List[CheckIn]:
    ds = parse_date(start)
    de = parse_date(end)
    if de < ds:
        raise HTTPException(status_code=400, detail="end must be >= start")

    cursor = mongo_db.checkins.find({"day": {"$gte": iso_date(ds), "$lte": iso_date(de)}}).sort("day", 1)
    out: List[CheckIn] = []
    async for doc in cursor:
        out.append(
            CheckIn(
                id=doc["_id"],
                day=doc["day"],
                wakeup_5am=doc["wakeup_5am"],
                workout=doc["workout"],
                video_captured=doc["video_captured"],
                notes=doc.get("notes", ""),
                created_at=doc.get("created_at", doc.get("updated_at", "")),
                updated_at=doc.get("updated_at", doc.get("created_at", "")),
            )
        )
    return out


# -----------------------------
# Fitness metrics
# -----------------------------

@app.post("/api/fitness/weight", response_model=MetricEntry)
async def add_weight(payload: WeightEntryCreate) -> MetricEntry:
    d = parse_date(payload.day)
    v = clamp_float(payload.weight_lbs, 80, 400, "weight_lbs")
    ts = now_utc().isoformat()
    doc = {"_id": new_id(), "day": iso_date(d), "kind": "weight", "value": v, "created_at": ts}
    await mongo_db.metrics.insert_one(doc)
    return MetricEntry(id=doc["_id"], day=doc["day"], kind="weight", value=v, created_at=ts)


@app.post("/api/fitness/body-fat", response_model=MetricEntry)
async def add_body_fat(payload: BodyFatEntryCreate) -> MetricEntry:
    d = parse_date(payload.day)
    v = clamp_float(payload.body_fat_pct, 3, 70, "body_fat_pct")
    ts = now_utc().isoformat()
    doc = {"_id": new_id(), "day": iso_date(d), "kind": "body_fat", "value": v, "created_at": ts}
    await mongo_db.metrics.insert_one(doc)
    return MetricEntry(id=doc["_id"], day=doc["day"], kind="body_fat", value=v, created_at=ts)


@app.post("/api/fitness/waist", response_model=MetricEntry)
async def add_waist(payload: WaistEntryCreate) -> MetricEntry:
    # Deprecated alias for body fat (kept so older clients don’t break)
    return await add_body_fat(BodyFatEntryCreate(day=payload.day, body_fat_pct=payload.waist_in))


@app.post("/api/fitness/photo", response_model=PhotoEntry)
async def upload_photo(day: str = Query(...), file: UploadFile = File(...)) -> PhotoEntry:
    d = parse_date(day)
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
        raise HTTPException(status_code=400, detail="Supported types: .jpg, .jpeg, .png, .webp")

    _id = new_id()
    safe_name = f"{iso_date(d)}-{_id}{ext}"
    full_path = os.path.join(UPLOAD_DIR, safe_name)

    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    with open(full_path, "wb") as f:
        f.write(contents)

    ts = now_utc().isoformat()
    url = f"/api/uploads/{safe_name}"
    doc = {"_id": _id, "day": iso_date(d), "filename": safe_name, "url": url, "created_at": ts}
    await mongo_db.photos.insert_one(doc)
    return PhotoEntry(id=_id, day=doc["day"], filename=safe_name, url=url, created_at=ts)


@app.get("/api/fitness/metrics")
async def get_fitness_metrics(
    start: str = Query(...),
    end: str = Query(...),
) -> Dict[str, Any]:
    ds = parse_date(start)
    de = parse_date(end)
    if de < ds:
        raise HTTPException(status_code=400, detail="end must be >= start")

    metrics: List[Dict[str, Any]] = []
    async for doc in mongo_db.metrics.find({"day": {"$gte": iso_date(ds), "$lte": iso_date(de)}}).sort("day", 1):
        kind = doc.get("kind")
        # Migrate old kind name in responses
        if kind == "waist":
            kind = "body_fat"
        metrics.append({"id": doc["_id"], "day": doc["day"], "kind": kind, "value": doc["value"], "created_at": doc["created_at"]})

    photos: List[Dict[str, Any]] = []
    async for doc in mongo_db.photos.find({"day": {"$gte": iso_date(ds), "$lte": iso_date(de)}}).sort("day", 1):
        photos.append({"id": doc["_id"], "day": doc["day"], "filename": doc["filename"], "url": doc["url"], "created_at": doc["created_at"]})

    latest_weight = await mongo_db.metrics.find({"kind": "weight"}).sort("day", -1).limit(1).to_list(length=1)
    latest_bf = await mongo_db.metrics.find({"kind": {"$in": ["body_fat", "waist"]}}).sort("day", -1).limit(1).to_list(length=1)

    return {
        "metrics": metrics,
        "photos": photos,
        "latest": {
            "weight_lbs": latest_weight[0]["value"] if latest_weight else None,
            "body_fat_pct": latest_bf[0]["value"] if latest_bf else None,
        },
    }


# -----------------------------
# Mortgage
# -----------------------------

@app.post("/api/mortgage/principal-payment", response_model=MortgageEvent)
async def add_principal_payment(payload: PrincipalPaymentCreate) -> MortgageEvent:
    d = parse_date(payload.day)
    amt = clamp_float(payload.amount, 1, 1_000_000, "amount")
    ts = now_utc().isoformat()
    doc = {
        "_id": new_id(),
        "day": iso_date(d),
        "kind": "principal_payment",
        "amount": amt,
        "note": payload.note or "",
        "created_at": ts,
    }
    await mongo_db.mortgage_events.insert_one(doc)
    return MortgageEvent(id=doc["_id"], day=doc["day"], kind="principal_payment", amount=amt, note=doc["note"], created_at=ts)


@app.post("/api/mortgage/balance-check", response_model=MortgageEvent)
async def add_balance_check(payload: BalanceCheckCreate) -> MortgageEvent:
    d = parse_date(payload.day)
    bal = clamp_float(payload.principal_balance, 1, 10_000_000, "principal_balance")
    ts = now_utc().isoformat()
    doc = {
        "_id": new_id(),
        "day": iso_date(d),
        "kind": "balance_check",
        "amount": bal,
        "note": payload.note or "",
        "created_at": ts,
    }
    await mongo_db.mortgage_events.insert_one(doc)
    return MortgageEvent(id=doc["_id"], day=doc["day"], kind="balance_check", amount=bal, note=doc["note"], created_at=ts)


@app.get("/api/mortgage/events", response_model=List[MortgageEvent])
async def list_mortgage_events(start: str = Query(...), end: str = Query(...)) -> List[MortgageEvent]:
    ds = parse_date(start)
    de = parse_date(end)
    cursor = mongo_db.mortgage_events.find({"day": {"$gte": iso_date(ds), "$lte": iso_date(de)}}).sort("day", 1)
    out: List[MortgageEvent] = []
    async for doc in cursor:
        out.append(
            MortgageEvent(
                id=doc["_id"],
                day=doc["day"],
                kind=doc["kind"],
                amount=float(doc["amount"]),
                note=doc.get("note", ""),
                created_at=doc.get("created_at", ""),
            )
        )
    return out


@app.get("/api/mortgage/summary")
async def mortgage_summary() -> Dict[str, Any]:
    # latest balance check
    latest_bal = await mongo_db.mortgage_events.find({"kind": "balance_check"}).sort("day", -1).limit(1).to_list(length=1)
    latest_principal_balance = float(latest_bal[0]["amount"]) if latest_bal else None

    today = date.today()
    y_start = date(today.year, 1, 1)
    m_start = date(today.year, today.month, 1)

    ytd_payments = await mongo_db.mortgage_events.aggregate(
        [
            {"$match": {"kind": "principal_payment", "day": {"$gte": iso_date(y_start), "$lte": iso_date(today)}}},
            {"$group": {"_id": None, "sum": {"$sum": "$amount"}}},
        ]
    ).to_list(length=1)

    month_payments = await mongo_db.mortgage_events.aggregate(
        [
            {"$match": {"kind": "principal_payment", "day": {"$gte": iso_date(m_start), "$lte": iso_date(today)}}},
            {"$group": {"_id": None, "sum": {"$sum": "$amount"}}},
        ]
    ).to_list(length=1)

    principal_paid_extra_ytd = float(ytd_payments[0]["sum"]) if ytd_payments else 0.0
    principal_paid_extra_month = float(month_payments[0]["sum"]) if month_payments else 0.0

    return {
        "mortgage_start_principal": MORTGAGE_START_PRINCIPAL,
        "mortgage_target_principal": MORTGAGE_TARGET_PRINCIPAL,
        "latest_principal_balance": latest_principal_balance,
        "principal_paid_extra_ytd": principal_paid_extra_ytd,
        "principal_paid_extra_month": principal_paid_extra_month,
        "progress": {
            "target_delta": MORTGAGE_START_PRINCIPAL - MORTGAGE_TARGET_PRINCIPAL,
            "paid_extra_ytd": principal_paid_extra_ytd,
        },
    }


# -----------------------------
# Relationship
# -----------------------------

@app.get("/api/relationship/trip", response_model=TripState)
async def get_trip() -> TripState:
    doc = await mongo_db.trip.find_one({"_id": "default"})
    if not doc:
        raise HTTPException(status_code=500, detail="Trip state missing")

    start_date = doc.get("start_date", "")
    end_date = doc.get("end_date", "")

    # Back-compat: if only legacy `dates` exists, keep returning it
    legacy_dates = doc.get("dates", "")

    return TripState(
        id=doc["_id"],
        start_date=start_date,
        end_date=end_date,
        dates=legacy_dates,
        adults_only=bool(doc.get("adults_only", True)),
        lodging_booked=bool(doc.get("lodging_booked", False)),
        childcare_confirmed=bool(doc.get("childcare_confirmed", False)),
        notes=doc.get("notes", ""),
        updated_at=doc.get("updated_at", ""),
    )


@app.put("/api/relationship/trip", response_model=TripState)
async def update_trip(payload: TripUpdate) -> TripState:
    # write-through + history
    prev = await mongo_db.trip.find_one({"_id": "default"})
    ts = now_utc().isoformat()

    # Validate dates when provided
    sd = payload.start_date or ""
    ed = payload.end_date or ""
    if sd:
        _ = parse_date(sd)
    if ed:
        _ = parse_date(ed)
    if sd and ed:
        if parse_date(ed) < parse_date(sd):
            raise HTTPException(status_code=400, detail="end_date must be >= start_date")

    await mongo_db.trip.update_one(
        {"_id": "default"},
        {
            "$set": {
                "start_date": sd,
                "end_date": ed,
                "dates": payload.dates or "",
                "adults_only": bool(payload.adults_only),
                "lodging_booked": bool(payload.lodging_booked),
                "childcare_confirmed": bool(payload.childcare_confirmed),
                "notes": payload.notes or "",
                "updated_at": ts,
            }
        },
        upsert=True,
    )

    if prev:
        # Save previous snapshot for audit/history
        snap = TripState(
            id=prev.get("_id", "default"),
            start_date=prev.get("start_date", ""),
            end_date=prev.get("end_date", ""),
            dates=prev.get("dates", ""),
            adults_only=bool(prev.get("adults_only", True)),
            lodging_booked=bool(prev.get("lodging_booked", False)),
            childcare_confirmed=bool(prev.get("childcare_confirmed", False)),
            notes=prev.get("notes", ""),
            updated_at=prev.get("updated_at", ts),
        ).model_dump()
        await mongo_db.trip_history.insert_one({
            "_id": new_id(),
            "trip_id": "default",
            "created_at": ts,
            "snapshot": snap,
        })

    return await get_trip()


@app.get("/api/relationship/trip/history", response_model=List[TripHistoryEntry])
async def trip_history(limit: int = Query(25, ge=1, le=200)) -> List[TripHistoryEntry]:
    out: List[TripHistoryEntry] = []
    cursor = mongo_db.trip_history.find({"trip_id": "default"}).sort("created_at", -1).limit(limit)
    async for doc in cursor:
        snap = doc.get("snapshot") or {}
        out.append(
            TripHistoryEntry(
                id=doc["_id"],
                trip_id=doc.get("trip_id", "default"),
                created_at=doc.get("created_at", ""),
                snapshot=TripState(**snap),
            )
        )
    return out


@app.post("/api/relationship/gifts", response_model=GiftEntry)
async def add_gift(payload: GiftCreate) -> GiftEntry:
    d = parse_date(payload.day)
    if not payload.description.strip():
        raise HTTPException(status_code=400, detail="description required")
    amt = float(payload.amount or 0)
    if amt < 0:
        raise HTTPException(status_code=400, detail="amount must be >= 0")

    ts = now_utc().isoformat()
    doc = {"_id": new_id(), "day": iso_date(d), "description": payload.description.strip(), "amount": amt, "created_at": ts}
    await mongo_db.gifts.insert_one(doc)
    return GiftEntry(id=doc["_id"], day=doc["day"], description=doc["description"], amount=amt, created_at=ts)


@app.get("/api/relationship/gifts", response_model=List[GiftEntry])
async def list_gifts(year: int = Query(...), month: int = Query(...)) -> List[GiftEntry]:
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="month must be 1-12")
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)

    out: List[GiftEntry] = []
    async for doc in mongo_db.gifts.find({"day": {"$gte": iso_date(start), "$lte": iso_date(end)}}).sort("day", -1):
        out.append(GiftEntry(id=doc["_id"], day=doc["day"], description=doc["description"], amount=float(doc.get("amount", 0)), created_at=doc.get("created_at", "")))
    return out


# -----------------------------
# Settings + Email (SendGrid placeholder)
# -----------------------------

async def get_settings_doc() -> Dict[str, Any]:
    doc = await mongo_db.settings.find_one({"_id": "default"})
    if not doc:
        await mongo_db.settings.insert_one({"_id": "default", "updated_at": now_utc().isoformat()})
        doc = await mongo_db.settings.find_one({"_id": "default"})
    return doc


@app.get("/api/settings", response_model=SettingsResponse)
async def get_settings() -> SettingsResponse:
    doc = await get_settings_doc()
    return SettingsResponse(
        id=doc["_id"],
        sendgrid_sender_email=doc.get("sendgrid_sender_email", ""),
        reminder_recipient_email=doc.get("reminder_recipient_email", ""),
        weekly_review_day=doc.get("weekly_review_day", "Sun"),
        weekly_review_hour_local=int(doc.get("weekly_review_hour_local", 9)),
        monthly_gift_day=int(doc.get("monthly_gift_day", 1)),
        email_enabled=bool(doc.get("email_enabled", False)),
        updated_at=doc.get("updated_at", ""),
    )


@app.put("/api/settings", response_model=SettingsResponse)
async def update_settings(payload: SettingsUpdate) -> SettingsResponse:
    # NOTE: For now we allow storing API key in DB because user doesn't have domain/account yet.
    # In production, prefer storing API keys in environment variables / secret manager.
    ts = now_utc().isoformat()
    await mongo_db.settings.update_one(
        {"_id": "default"},
        {
            "$set": {
                "sendgrid_api_key": payload.sendgrid_api_key or "",
                "sendgrid_sender_email": payload.sendgrid_sender_email or "",
                "reminder_recipient_email": payload.reminder_recipient_email or "",
                "weekly_review_day": payload.weekly_review_day,
                "weekly_review_hour_local": int(payload.weekly_review_hour_local),
                "monthly_gift_day": int(payload.monthly_gift_day),
                "email_enabled": bool(payload.email_enabled),
                "updated_at": ts,
            }
        },
        upsert=True,
    )
    return await get_settings()


# -----------------------------
# Weekly review computation
# -----------------------------

def week_bounds(anchor: date) -> Tuple[date, date]:
    # Sunday-start week
    # weekday(): Mon=0..Sun=6
    days_since_sun = (anchor.weekday() + 1) % 7
    start = anchor - timedelta(days=days_since_sun)
    end = start + timedelta(days=6)
    return start, end


@app.get("/api/review/weekly", response_model=WeeklyReviewResponse)
async def weekly_review(anchor_day: Optional[str] = Query(None)) -> WeeklyReviewResponse:
    anchor = parse_date(anchor_day) if anchor_day else date.today()
    ws, we = week_bounds(anchor)

    checkins = await mongo_db.checkins.find({"day": {"$gte": iso_date(ws), "$lte": iso_date(we)}}).to_list(length=200)
    wakeups = sum(1 for c in checkins if c.get("wakeup_5am"))
    workouts = sum(1 for c in checkins if c.get("workout"))
    videos = sum(1 for c in checkins if c.get("video_captured"))

    mortgage_actions = await mongo_db.mortgage_events.count_documents({"day": {"$gte": iso_date(ws), "$lte": iso_date(we)}})
    relationship_actions = await mongo_db.gifts.count_documents({"day": {"$gte": iso_date(ws), "$lte": iso_date(we)}})

    return WeeklyReviewResponse(
        week_start=iso_date(ws),
        week_end=iso_date(we),
        wakeups_ge_4=wakeups >= 4,
        workouts_completed_5=workouts >= 5,
        captured_at_least_1_video=videos >= 1,
        mortgage_action_taken=mortgage_actions >= 1,
        relationship_action_taken=relationship_actions >= 1,
    )


# -----------------------------
# Dashboard summary + reminders
# -----------------------------

async def calc_current_streak(field: str) -> int:
    # Compute consecutive days including today going backwards where checkin.field is True
    today = date.today()
    streak = 0
    for i in range(0, 120):
        d = today - timedelta(days=i)
        doc = await mongo_db.checkins.find_one({"day": iso_date(d)})
        if not doc or not doc.get(field, False):
            break
        streak += 1
    return streak


@app.get("/api/summary", response_model=SummaryResponse)
async def summary() -> SummaryResponse:
    today = date.today()
    ws, we = week_bounds(today)

    week_checkins = await mongo_db.checkins.find({"day": {"$gte": iso_date(ws), "$lte": iso_date(we)}}).to_list(length=200)

    week_wakeup_count = sum(1 for c in week_checkins if c.get("wakeup_5am"))
    week_workout_count = sum(1 for c in week_checkins if c.get("workout"))
    week_video_count = sum(1 for c in week_checkins if c.get("video_captured"))

    current_wakeup_streak = await calc_current_streak("wakeup_5am")
    current_workout_streak = await calc_current_streak("workout")

    latest_weight = await mongo_db.metrics.find({"kind": "weight"}).sort("day", -1).limit(1).to_list(length=1)
    latest_bf = await mongo_db.metrics.find({"kind": {"$in": ["body_fat", "waist"]}}).sort("day", -1).limit(1).to_list(length=1)

    mortgage = await mortgage_summary()

    trip_doc = await mongo_db.trip.find_one({"_id": "default"})
    trip_lodging_booked = bool(trip_doc.get("lodging_booked", False)) if trip_doc else False
    trip_childcare_confirmed = bool(trip_doc.get("childcare_confirmed", False)) if trip_doc else False

    month_start = date(today.year, today.month, 1)
    gifts_this_month = await mongo_db.gifts.count_documents({"day": {"$gte": iso_date(month_start), "$lte": iso_date(today)}})

    reminders: List[Dict[str, Any]] = []

    # In-app reminders
    # 1) Weekly weigh-in (no weight entry in last 7 days)
    last_weight_doc = latest_weight[0] if latest_weight else None
    if last_weight_doc:
        last_weight_day = parse_date(last_weight_doc["day"])
        if (today - last_weight_day).days >= 7:
            reminders.append({"id": "weight-overdue", "area": "Fitness", "message": "Weight check-in overdue (aim weekly).", "severity": "warning"})
    else:
        reminders.append({"id": "weight-missing", "area": "Fitness", "message": "No weight logged yet (weekly).", "severity": "info"})

    # 2) Waist (every 14 days)
    last_waist_doc = latest_waist[0] if latest_waist else None
    if last_waist_doc:
        last_waist_day = parse_date(last_waist_doc["day"])
        if (today - last_waist_day).days >= 14:
            reminders.append({"id": "waist-overdue", "area": "Fitness", "message": "Waist measurement overdue (every 2 weeks).", "severity": "warning"})
    else:
        reminders.append({"id": "waist-missing", "area": "Fitness", "message": "No waist measurement logged yet (every 2 weeks).", "severity": "info"})

    # 3) Monthly photo (no photo this month)
    photo_count = await mongo_db.photos.count_documents({"day": {"$gte": iso_date(month_start), "$lte": iso_date(today)}})
    if photo_count == 0:
        reminders.append({"id": "photo-missing", "area": "Fitness", "message": "No progress photo logged yet this month.", "severity": "info"})

    # 4) Monthly gift
    if gifts_this_month == 0:
        reminders.append({"id": "gift-missing", "area": "Relationship", "message": "No gift/gesture logged this month yet.", "severity": "info"})

    # 5) Mortgage monthly balance check
    last_balance = await mongo_db.mortgage_events.find({"kind": "balance_check"}).sort("day", -1).limit(1).to_list(length=1)
    if last_balance:
        last_balance_day = parse_date(last_balance[0]["day"])
        if (today - last_balance_day).days >= 30:
            reminders.append({"id": "mortgage-balance-overdue", "area": "Mortgage", "message": "Mortgage principal balance check overdue (monthly).", "severity": "warning"})
    else:
        reminders.append({"id": "mortgage-balance-missing", "area": "Mortgage", "message": "Log your first mortgage principal balance check.", "severity": "info"})

    return SummaryResponse(
        today=iso_date(today),
        current_wakeup_streak=current_wakeup_streak,
        current_workout_streak=current_workout_streak,
        week_wakeup_count=week_wakeup_count,
        week_workout_count=week_workout_count,
        week_video_count=week_video_count,
        latest_weight_lbs=latest_weight[0]["value"] if latest_weight else None,
        latest_waist_in=latest_waist[0]["value"] if latest_waist else None,
        mortgage_target_principal=MORTGAGE_TARGET_PRINCIPAL,
        mortgage_start_principal=MORTGAGE_START_PRINCIPAL,
        latest_principal_balance=mortgage.get("latest_principal_balance"),
        principal_paid_extra_ytd=float(mortgage.get("principal_paid_extra_ytd", 0.0)),
        principal_paid_extra_month=float(mortgage.get("principal_paid_extra_month", 0.0)),
        trip_lodging_booked=trip_lodging_booked,
        trip_childcare_confirmed=trip_childcare_confirmed,
        gifts_this_month=gifts_this_month,
        reminders=reminders,
    )
