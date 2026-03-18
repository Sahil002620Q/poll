import asyncio
import websockets
import json
import requests
import sys 

API_URL = "http://localhost:8000"
WS_URL = "ws://localhost:8000"

async def test_flow():
    # 1. Create Room (Host)
    try:
        res = requests.post(f"{API_URL}/create_room")
        res.raise_for_status()
        room_code = res.json()["room_code"]
        print(f"Room created: {room_code}")
    except Exception as e:
        print(f"Failed to create room: {e}")
        return 1

    # 2. Check room exists
    res = requests.get(f"{API_URL}/rooms/{room_code}")
    if res.json()["status"] != "ok":
        print("Room check failed")
        return 1
        
    async with websockets.connect(f"{WS_URL}/ws/host/{room_code}") as host_ws:
        
        async with websockets.connect(f"{WS_URL}/ws/client/{room_code}/tester_1234") as client_ws:
            
            # Client receives initial state
            msg = json.loads(await client_ws.recv())
            if msg["type"] != "room_state":
                print("Failed to receive room state")
                return 1
            print("Client joined successfully")
            
            # Host creates a poll
            poll_data = {
                "action": "create_poll",
                "question": "Favorite Color?",
                "options": ["Red", "Blue", "Green", "Yellow"],
                "time": 2  # Very short time to test timeout quickly
            }
            await host_ws.send(json.dumps(poll_data))
            
            # Everyone should receive poll_created
            host_msg = json.loads(await host_ws.recv())
            if host_msg["type"] != "poll_created":
                print("Host did not receive poll_created")
                return 1
                
            client_msg = json.loads(await client_ws.recv())
            if client_msg["type"] != "poll_created":
                print("Client did not receive poll_created")
                return 1
                
            print("Poll created successfully")
            
            # Host starts poll
            await host_ws.send(json.dumps({"action": "start_poll"}))
            
            host_msg = json.loads(await host_ws.recv())  # poll_started
            client_msg = json.loads(await client_ws.recv()) # poll_started
            
            if host_msg["type"] != "poll_started" or client_msg["type"] != "poll_started":
                print("Failed to start poll")
                return 1
                
            print("Poll started")
            
            # Client sends vote
            await client_ws.send(json.dumps({"action": "vote", "option_id": 0}))
            
            # Host should receive vote_update
            host_msg = json.loads(await host_ws.recv())
            if host_msg["type"] != "vote_update" or host_msg["poll"]["options"][0]["votes"] != 1:
                print("Host did not receive vote update correctly")
                return 1
                
            print("Vote received correctly")
            
            # Client sends chat
            await client_ws.send(json.dumps({"action": "chat", "text": "Tester: Hello!"}))
            
            # Both receive chat
            chat1 = json.loads(await host_ws.recv())  # timer_update or chat
            chat2 = json.loads(await client_ws.recv())
            
            # Let's wait for poll_ended
            poll_ended = False
            for _ in range(10): # Max 10 messages
                m = json.loads(await client_ws.recv())
                if m["type"] == "poll_ended":
                    poll_ended = True
                    break
                    
            if not poll_ended:
                print("Poll did not end automatically")
                return 1
                
            print("Poll ended successfully by timer")
            return 0

if __name__ == "__main__":
    sys.exit(asyncio.run(test_flow()))
