#!/usr/bin/env python3
"""
Backend API Testing for 2026 Accountability Tracker
Tests all endpoints with comprehensive coverage
"""

import os
import requests
import sys
import json
from datetime import datetime, date, timedelta
from typing import Dict, Any, Optional

class AccountabilityAPITester:
    def __init__(self, base_url: Optional[str] = None):
        # Prefer APP_URL (same env var used by supervisor) so this script works across environments.
        self.base_url = base_url or os.environ.get("APP_URL") or "http://localhost:8001"
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        self.session = requests.Session()
        self.session.timeout = 15

    def log_test(self, name: str, success: bool, details: str = ""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            self.failed_tests.append({"name": name, "details": details})
            print(f"❌ {name} - {details}")

    def run_test(self, name: str, method: str, endpoint: str, expected_status: int, 
                 data: Optional[Dict] = None, params: Optional[Dict] = None) -> tuple[bool, Dict]:
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        
        try:
            if method == 'GET':
                response = self.session.get(url, params=params)
            elif method == 'POST':
                response = self.session.post(url, json=data, params=params)
            elif method == 'PUT':
                response = self.session.put(url, json=data, params=params)
            else:
                raise ValueError(f"Unsupported method: {method}")

            success = response.status_code == expected_status
            response_data = {}
            
            try:
                response_data = response.json()
            except:
                response_data = {"raw_response": response.text}

            if success:
                self.log_test(name, True)
            else:
                self.log_test(name, False, f"Expected {expected_status}, got {response.status_code}: {response.text[:200]}")

            return success, response_data

        except Exception as e:
            self.log_test(name, False, f"Exception: {str(e)}")
            return False, {}

    def test_health(self) -> bool:
        """Test health endpoint"""
        success, data = self.run_test("Health Check", "GET", "api/health", 200)
        if success and data.get("status") == "ok":
            print(f"   Health status: {data.get('status')}, App: {data.get('app')}")
            return True
        return False

    def test_summary(self) -> bool:
        """Test summary endpoint"""
        success, data = self.run_test("Dashboard Summary", "GET", "api/summary", 200)
        if success:
            print(f"   Today: {data.get('today')}")
            print(f"   Wakeup streak: {data.get('current_wakeup_streak')}")
            print(f"   Workout streak: {data.get('current_workout_streak')}")
            print(f"   Reminders: {len(data.get('reminders', []))}")
            return True
        return False

    def test_checkin_flow(self) -> bool:
        """Test check-in upsert and retrieval"""
        today = date.today().isoformat()
        
        # Test upsert check-in
        checkin_data = {
            "day": today,
            "wakeup_5am": True,
            "workout": True,
            "video_captured": False,
            "notes": "Test check-in from automated test"
        }
        
        success, data = self.run_test("Upsert Check-in", "POST", "api/checkins/upsert", 200, checkin_data)
        if not success:
            return False
            
        checkin_id = data.get("id")
        if checkin_id:
            print(f"   Created check-in ID: {checkin_id}")
        
        # Test list check-ins
        start_date = (date.today() - timedelta(days=7)).isoformat()
        end_date = today
        
        success, data = self.run_test("List Check-ins", "GET", "api/checkins", 200, 
                                    params={"start": start_date, "end": end_date})
        if success:
            print(f"   Retrieved {len(data)} check-ins")
            return True
        return False

    def test_fitness_flow(self) -> bool:
        """Test fitness metrics (weight, waist)"""
        today = date.today().isoformat()
        
        # Test add weight
        weight_data = {"day": today, "weight_lbs": 175.5}
        success, data = self.run_test("Add Weight", "POST", "api/fitness/weight", 200, weight_data)
        if not success:
            return False
        print(f"   Added weight: {data.get('value')} lbs")
        
        # Test add waist
        waist_data = {"day": today, "waist_in": 34.0}
        success, data = self.run_test("Add Waist", "POST", "api/fitness/waist", 200, waist_data)
        if not success:
            return False
        print(f"   Added waist: {data.get('value')} in")
        
        # Test get fitness metrics
        start_date = (date.today() - timedelta(days=30)).isoformat()
        end_date = today
        
        success, data = self.run_test("Get Fitness Metrics", "GET", "api/fitness/metrics", 200,
                                    params={"start": start_date, "end": end_date})
        if success:
            metrics = data.get("metrics", [])
            photos = data.get("photos", [])
            latest = data.get("latest", {})
            print(f"   Retrieved {len(metrics)} metrics, {len(photos)} photos")
            print(f"   Latest weight: {latest.get('weight_lbs')}, waist: {latest.get('waist_in')}")
            return True
        return False

    def test_mortgage_flow(self) -> bool:
        """Test mortgage tracking"""
        today = date.today().isoformat()
        
        # Test add principal payment
        payment_data = {
            "day": today,
            "amount": 1500.0,
            "note": "Extra principal payment - test"
        }
        success, data = self.run_test("Add Principal Payment", "POST", "api/mortgage/principal-payment", 200, payment_data)
        if not success:
            return False
        print(f"   Added payment: ${data.get('amount')}")
        
        # Test add balance check
        balance_data = {
            "day": today,
            "principal_balance": 328500.0,
            "note": "Monthly balance check - test"
        }
        success, data = self.run_test("Add Balance Check", "POST", "api/mortgage/balance-check", 200, balance_data)
        if not success:
            return False
        print(f"   Added balance check: ${data.get('amount')}")
        
        # Test get mortgage events
        start_date = (date.today() - timedelta(days=30)).isoformat()
        end_date = today
        
        success, data = self.run_test("List Mortgage Events", "GET", "api/mortgage/events", 200,
                                    params={"start": start_date, "end": end_date})
        if not success:
            return False
        print(f"   Retrieved {len(data)} mortgage events")
        
        # Test mortgage summary
        success, data = self.run_test("Mortgage Summary", "GET", "api/mortgage/summary", 200)
        if success:
            print(f"   Start principal: ${data.get('mortgage_start_principal')}")
            print(f"   Target principal: ${data.get('mortgage_target_principal')}")
            print(f"   Latest balance: ${data.get('latest_principal_balance')}")
            print(f"   Extra paid YTD: ${data.get('principal_paid_extra_ytd')}")
            return True
        return False

    def test_relationship_flow(self) -> bool:
        """Test relationship tracking (trip, gifts)"""
        today = date.today().isoformat()
        
        # Test get trip
        success, data = self.run_test("Get Trip", "GET", "api/relationship/trip", 200)
        if not success:
            return False
        
        # Test update trip with structured dates
        future_start = (date.today() + timedelta(days=30)).isoformat()
        future_end = (date.today() + timedelta(days=33)).isoformat()
        
        trip_data = {
            "start_date": future_start,
            "end_date": future_end,
            "dates": "Spring getaway",
            "adults_only": True,
            "lodging_booked": True,
            "childcare_confirmed": False,
            "notes": "Beach resort getaway - test update with structured dates"
        }
        success, data = self.run_test("Update Trip with Structured Dates", "PUT", "api/relationship/trip", 200, trip_data)
        if not success:
            return False
        print(f"   Updated trip: {data.get('start_date')} → {data.get('end_date')}")
        print(f"   Adults-only: {data.get('adults_only')}, Lodging: {data.get('lodging_booked')}")
        
        # Test trip history
        success, history_data = self.run_test("Get Trip History", "GET", "api/relationship/trip/history", 200,
                                            params={"limit": 10})
        if not success:
            return False
        print(f"   Retrieved {len(history_data)} trip history entries")
        
        # Test add gift
        gift_data = {
            "day": today,
            "description": "Surprise flowers - test gift",
            "amount": 45.0
        }
        success, data = self.run_test("Add Gift", "POST", "api/relationship/gifts", 200, gift_data)
        if not success:
            return False
        print(f"   Added gift: {data.get('description')} - ${data.get('amount')}")
        
        # Test list gifts
        current_date = date.today()
        success, data = self.run_test("List Gifts", "GET", "api/relationship/gifts", 200,
                                    params={"year": current_date.year, "month": current_date.month})
        if success:
            print(f"   Retrieved {len(data)} gifts for current month")
            return True
        return False

    def test_settings_flow(self) -> bool:
        """Test settings (SendGrid configuration)"""
        # Test get settings
        success, data = self.run_test("Get Settings", "GET", "api/settings", 200)
        if not success:
            return False
        
        original_settings = data.copy()
        
        # Test update settings
        settings_data = {
            "sendgrid_api_key": "SG.test_key_12345",
            "sendgrid_sender_email": "test@example.com",
            "reminder_recipient_email": "user@example.com",
            "weekly_review_day": "Mon",
            "weekly_review_hour_local": 10,
            "monthly_gift_day": 15,
            "email_enabled": True
        }
        success, data = self.run_test("Update Settings", "PUT", "api/settings", 200, settings_data)
        if success:
            print(f"   Email enabled: {data.get('email_enabled')}")
            print(f"   Weekly review: {data.get('weekly_review_day')} at {data.get('weekly_review_hour_local')}:00")
            print(f"   Monthly gift day: {data.get('monthly_gift_day')}")
            return True
        return False

    def test_vacation_planner_validation(self) -> bool:
        """Test vacation planner date validation"""
        today = date.today().isoformat()
        future_start = (date.today() + timedelta(days=30)).isoformat()
        future_end = (date.today() + timedelta(days=25)).isoformat()  # End before start
        
        # Test invalid date range (end_date < start_date)
        invalid_trip_data = {
            "start_date": future_start,
            "end_date": future_end,  # This is before start_date
            "adults_only": True,
            "notes": "This should fail validation"
        }
        success, data = self.run_test("Trip Validation - Invalid Date Range", "PUT", "api/relationship/trip", 400, invalid_trip_data)
        if success:
            print(f"   Correctly rejected invalid date range")
        else:
            print(f"   ❌ Should have rejected end_date < start_date")
            return False
        
        # Test valid date range
        valid_future_end = (date.today() + timedelta(days=35)).isoformat()
        valid_trip_data = {
            "start_date": future_start,
            "end_date": valid_future_end,
            "adults_only": False,
            "notes": "Valid date range test"
        }
        success, data = self.run_test("Trip Validation - Valid Date Range", "PUT", "api/relationship/trip", 200, valid_trip_data)
        if success:
            print(f"   Accepted valid date range: {data.get('start_date')} → {data.get('end_date')}")
            return True
        return False

    def test_weekly_review(self) -> bool:
        """Test weekly review endpoint"""
        today = date.today().isoformat()
        
        success, data = self.run_test("Weekly Review", "GET", "api/review/weekly", 200,
                                    params={"anchor_day": today})
        if success:
            print(f"   Week: {data.get('week_start')} to {data.get('week_end')}")
            print(f"   Wakeups ≥4: {data.get('wakeups_ge_4')}")
            print(f"   Workouts ≥5: {data.get('workouts_completed_5')}")
            print(f"   Video ≥1: {data.get('captured_at_least_1_video')}")
            return True
        return False

    def run_all_tests(self) -> Dict[str, Any]:
        """Run all tests and return results"""
        print("🚀 Starting 2026 Accountability Tracker API Tests")
        print(f"Testing against: {self.base_url}")
        print("=" * 60)
        
        # Test each component
        test_results = {
            "health": self.test_health(),
            "summary": self.test_summary(),
            "checkin": self.test_checkin_flow(),
            "fitness": self.test_fitness_flow(),
            "mortgage": self.test_mortgage_flow(),
            "relationship": self.test_relationship_flow(),
            "settings": self.test_settings_flow(),
            "weekly_review": self.test_weekly_review()
        }
        
        print("=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.failed_tests:
            print("\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"   • {test['name']}: {test['details']}")
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        print(f"Success Rate: {success_rate:.1f}%")
        
        return {
            "total_tests": self.tests_run,
            "passed_tests": self.tests_passed,
            "failed_tests": len(self.failed_tests),
            "success_rate": success_rate,
            "test_results": test_results,
            "failed_details": self.failed_tests
        }

def main():
    """Main test runner"""
    tester = AccountabilityAPITester()
    results = tester.run_all_tests()
    
    # Return appropriate exit code
    return 0 if results["failed_tests"] == 0 else 1

if __name__ == "__main__":
    sys.exit(main())