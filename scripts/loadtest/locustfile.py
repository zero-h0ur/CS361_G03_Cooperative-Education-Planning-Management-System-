"""Load test สำหรับระบบทดสอบของ CO-ED (ห้ามยิง API ตัวจริง)

3 การกระทำ (สัดส่วนตาม request):
  list   40%  GET   /api/directory/companies?page=&pageSize=20[&q=][&location=]
  detail 40%  GET   /api/directory/companies/{id}
  write  20%  PATCH /api/v3/plans/{id}   (บันทึกร่างแผนด้วยบัญชีทดสอบ)

ใช้งาน:
  locust -f scripts/loadtest/locustfile.py --host https://<api-id>.execute-api.ap-southeast-2.amazonaws.com
  แล้วเปิด http://localhost:8089

token: scripts/loadtest/tokens.json จาก capture-tokens.py ({"accounts": [...]}) หรือ tmp/loadtest/tokens.json
ถ้าไม่มีไฟล์ token จะยิงเฉพาะ list/detail (ใช้ทดสอบสคริปต์ก่อนบัญชีพร้อม)
"""
import itertools
import json
import os
import random
import time
import uuid
from pathlib import Path

import requests
from gevent.lock import Semaphore
from locust import HttpUser, LoadTestShape, between, events, task

PROD_API_HOSTS = ("yhfevhqtoa",)
TOKEN_URL = os.environ.get(
    "COGNITO_TOKEN_URL",
    "https://coed-v4-130165494095.auth.ap-southeast-2.amazoncognito.com/oauth2/token")
CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID", "65b8bifg3860706esa1uns6cd8")
CLIENT_SECRET = os.environ.get("COGNITO_CLIENT_SECRET")  # ปกติไม่มี (public client)
_HERE = Path(__file__).resolve().parent
TOKEN_CANDIDATES = [Path(os.environ["LOADTEST_TOKENS"])] if os.environ.get("LOADTEST_TOKENS") else [
    _HERE / "tokens.json",                          # ที่ capture-tokens.py เขียนไว้
    _HERE.parents[1] / "tmp" / "loadtest" / "tokens.json",
]
SEARCH_WORDS = ["", "", "", "จำกัด", "ซอฟต์", "tech", "data", "LOADTEST", "ไทย", "digital"]
PAGE_SIZE = 20


@events.test_start.add_listener
def refuse_production(environment, **_):
    host = environment.host or ""
    if any(h in host for h in PROD_API_HOSTS):
        raise SystemExit("หยุด: host นี้คือ API ตัวจริง ให้ใช้ URL ของ coed-loadtest-api เท่านั้น")


class Account:
    """เก็บ access token ของบัญชีทดสอบ 1 บัญชี ใช้ร่วมกันได้หลาย Locust user"""

    def __init__(self, username, refresh_token):
        self.username = username
        self.refresh_token = refresh_token
        self.access_token = None
        self.expires_at = 0.0
        self.lock = Semaphore()
        self.plan_id = None
        self.version = None

    def token(self, force=False):
        with self.lock:
            if force or not self.access_token or time.time() > self.expires_at - 300:
                data = {"grant_type": "refresh_token", "client_id": CLIENT_ID,
                        "refresh_token": self.refresh_token}
                auth = (CLIENT_ID, CLIENT_SECRET) if CLIENT_SECRET else None
                r = requests.post(TOKEN_URL, data=data, auth=auth, timeout=10)
                if r.status_code != 200:
                    raise RuntimeError(f"ขอ token ของ {self.username} ไม่สำเร็จ ({r.status_code}) "
                                       "refresh token อาจหมดอายุ ให้เก็บ token ใหม่")
                body = r.json()
                self.access_token = body["access_token"]
                self.expires_at = time.time() + int(body.get("expires_in", 3600))
            return self.access_token


def load_accounts():
    path = next((p for p in TOKEN_CANDIDATES if p.exists()), None)
    if path is None:
        print("[loadtest] ไม่พบ tokens.json จะยิงเฉพาะ list/detail")
        return []
    data = json.loads(path.read_text())
    rows = data.get("accounts", []) if isinstance(data, dict) else data  # รองรับทั้ง {"accounts": [...]} และ [...]
    accounts = [Account(r["username"], r["refresh_token"]) for r in rows if r.get("refresh_token")]
    print(f"[loadtest] โหลดบัญชีทดสอบ {len(accounts)} บัญชีจาก {path}")
    return accounts


ACCOUNTS = load_accounts()
ACCOUNT_CYCLE = itertools.cycle(ACCOUNTS) if ACCOUNTS else None
COMPANY_IDS = []
LOCATIONS = []
TOTAL_PAGES = [1]
CATALOG_LOCK = Semaphore()


def count_event(environment, name):
    """แสดงเป็นแถวแยกในตาราง Statistics โดยไม่นับเป็น error"""
    environment.events.request.fire(request_type="INFO", name=name, response_time=0,
                                    response_length=0, exception=None, context={})


class Student(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        self.account = next(ACCOUNT_CYCLE) if ACCOUNT_CYCLE else None
        with CATALOG_LOCK:
            if not COMPANY_IDS:
                self.load_catalog()

    def load_catalog(self):
        r = self.client.get(f"/api/directory/companies?page=1&pageSize={PAGE_SIZE}", name="list")
        if r.status_code != 200:
            return
        body = r.json()
        meta = body.get("pagination") or {}
        TOTAL_PAGES[0] = max(1, int(meta.get("totalPages") or 1))
        LOCATIONS[:] = (meta.get("filters") or {}).get("locations") or []
        COMPANY_IDS.extend(c["id"] for c in body.get("data", []))
        for page in range(2, min(TOTAL_PAGES[0], 10) + 1):
            r = self.client.get(f"/api/directory/companies?page={page}&pageSize={PAGE_SIZE}", name="list")
            if r.status_code == 200:
                COMPANY_IDS.extend(c["id"] for c in r.json().get("data", []))

    def auth_headers(self, force=False):
        return {"Authorization": f"Bearer {self.account.token(force)}"}

    @task(4)
    def list_companies(self):
        params = {"page": random.randint(1, TOTAL_PAGES[0]), "pageSize": PAGE_SIZE}
        word = random.choice(SEARCH_WORDS)
        if word:
            params["q"] = word
            params["page"] = 1
        if LOCATIONS and random.random() < 0.3:
            params["location"] = random.choice(LOCATIONS)
            params["page"] = 1
        self.client.get("/api/directory/companies", params=params, name="list")

    @task(4)
    def company_detail(self):
        if not COMPANY_IDS:
            return
        self.client.get(f"/api/directory/companies/{random.choice(COMPANY_IDS)}", name="detail")

    @task(2)
    def save_plan_draft(self):
        acc = self.account
        if acc is None:
            return
        if acc.plan_id is None or acc.version is None:
            if not self.refresh_plan():
                return
        body = {"notes": f"loadtest {time.strftime('%H:%M:%S')} {random.randint(1000, 9999)}",
                "expected_version": acc.version, "operation_id": str(uuid.uuid4())}
        with self.client.patch(f"/api/v3/plans/{acc.plan_id}", json=body, headers=self.auth_headers(),
                               name="write", catch_response=True) as r:
            if r.status_code == 200:
                acc.version = int(r.json()["data"]["version"])
                r.success()
            elif r.status_code == 409:
                # version ชนเพราะหลาย Locust user ใช้บัญชีเดียวกัน ไม่ใช่ปัญหาของระบบ
                r.success()
                count_event(self.environment, "write 409 (บัญชีซ้ำ)")
                acc.version = None
            elif r.status_code == 401:
                r.failure("401 token ใช้ไม่ได้")
                self.auth_headers(force=True)
            else:
                r.failure(f"{r.status_code}")

    def refresh_plan(self):
        """อ่านแผนร่างของบัญชีนี้ (นับเป็น read) เพื่อเอา id และ version ล่าสุด"""
        acc = self.account
        with self.client.get("/api/v3/plans", headers=self.auth_headers(), name="write: read plan",
                             catch_response=True) as r:
            if r.status_code != 200:
                r.failure(f"{r.status_code}")
                return False
            plans = [p for p in r.json().get("data", []) if p.get("status") in ("DRAFT", "NEEDS_REVISION")]
            if not plans:
                r.failure(f"บัญชี {acc.username} ไม่มีแผนร่าง")
                return False
            acc.plan_id, acc.version = plans[0]["id"], int(plans[0]["version"])
            r.success()
            return True


# ขั้นบันไดตามแล็บ Module 10: 10 -> 20 -> 40 users ขั้นละ 2 นาที แล้ว 80 users อีก 6 นาที รวม 12 นาที
# ปิดได้ด้วย LOADTEST_STEPS=off (ใช้ตอนวัด baseline 2 users)
if os.environ.get("LOADTEST_STEPS", "on").lower() != "off":
    class StepLoad(LoadTestShape):
        steps = [(120, 10), (240, 20), (360, 40), (720, 80)]

        def tick(self):
            t = self.get_run_time()
            for end, users in self.steps:
                if t < end:
                    return (users, 5)
            return None
