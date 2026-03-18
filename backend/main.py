import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from typing import Dict, Any
import random
import string
import asyncio
import json

app = FastAPI()

# Enable CORS for local cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for rooms
rooms: Dict[str, Any] = {}

class ConnectionManager:
    def __init__(self):
        pass

    async def connect_host(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        if room_id not in rooms:
            rooms[room_id] = {
                "host": websocket,
                "clients": set(),
                "state": {
                    "poll": None,
                    "chat_enabled": True,
                    "voted_users": set(),
                    "timer_task": None
                }
            }
        else:
            rooms[room_id]["host"] = websocket 

    async def connect_client(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        if room_id in rooms:
            rooms[room_id]["clients"].add(websocket)
            await self.send_personal_message({"type": "room_state", "state": self.get_safe_state(room_id)}, websocket)
            return True
        else:
            await websocket.close(code=4000, reason="Room not found")
            return False

    def disconnect_host(self, room_id: str):
        if room_id in rooms:
            rooms[room_id]["host"] = None

    def disconnect_client(self, websocket: WebSocket, room_id: str):
        if room_id in rooms and websocket in rooms[room_id]["clients"]:
            rooms[room_id]["clients"].remove(websocket)

    async def broadcast_to_room(self, message: dict, room_id: str):
        if room_id in rooms:
            dead_clients = set()
            for client in list(rooms[room_id]["clients"]):
                try:
                    await client.send_json(message)
                except Exception:
                    dead_clients.add(client)
            for dead in dead_clients:
                if dead in rooms[room_id]["clients"]:
                    rooms[room_id]["clients"].remove(dead)
            
            host = rooms[room_id]["host"]
            if host:
                try:
                    await host.send_json(message)
                except Exception:
                    pass

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        try:
            await websocket.send_json(message)
        except Exception:
            pass

    def get_safe_state(self, room_id: str):
        state = rooms[room_id]["state"]
        return {
            "poll": state["poll"],
            "chat_enabled": state["chat_enabled"]
        }

manager = ConnectionManager()

def generate_room_code():
    while True:
        code = ''.join(random.choices(string.digits, k=6))
        if code not in rooms:
            return code

@app.post("/create_room")
async def create_room():
    room_code = generate_room_code()
    rooms[room_code] = {
        "host": None,
        "clients": set(),
        "state": {
            "poll": None,
            "chat_enabled": True,
            "voted_users": set(),
            "timer_task": None
        }
    }
    return {"room_code": room_code}

@app.get("/rooms/{room_id}")
async def check_room(room_id: str):
    if room_id in rooms:
        return {"status": "ok"}
    return {"status": "not_found"}

async def run_timer(room_id: str, time_left: int):
    try:
        while time_left > 0:
            await asyncio.sleep(1)
            time_left -= 1
            await manager.broadcast_to_room({"type": "timer_update", "time": time_left}, room_id)
        
        # Timer ended
        if room_id in rooms and rooms[room_id]["state"]["poll"]:
            rooms[room_id]["state"]["poll"]["active"] = False
            rooms[room_id]["state"]["poll"]["status"] = "ended"
            await manager.broadcast_to_room({"type": "poll_ended", "results": rooms[room_id]["state"]["poll"]}, room_id)
    except asyncio.CancelledError:
        pass

@app.websocket("/ws/host/{room_id}")
async def websocket_host(websocket: WebSocket, room_id: str):
    if room_id not in rooms:
        await websocket.accept()
        await websocket.close(code=4000, reason="Room not found")
        return

    await manager.connect_host(websocket, room_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            action = message.get("action")
            
            if action == "create_poll":
                poll_time = message.get("time")
                rooms[room_id]["state"]["poll"] = {
                    "question": message["question"],
                    "options": [{"id": i, "text": opt, "votes": 0} for i, opt in enumerate(message["options"])],
                    "time": int(poll_time) if poll_time else None,
                    "active": False,
                    "status": "created"
                }
                rooms[room_id]["state"]["voted_users"] = set()
                await manager.broadcast_to_room({"type": "poll_created", "poll": rooms[room_id]["state"]["poll"]}, room_id)
                
            elif action == "start_poll":
                if rooms[room_id]["state"]["poll"]:
                    rooms[room_id]["state"]["poll"]["active"] = True
                    rooms[room_id]["state"]["poll"]["status"] = "active"
                    poll_time = rooms[room_id]["state"]["poll"]["time"]
                    await manager.broadcast_to_room({"type": "poll_started", "time": poll_time}, room_id)
                    
                    if rooms[room_id]["state"]["timer_task"]:
                        rooms[room_id]["state"]["timer_task"].cancel()
                    
                    if poll_time:
                        rooms[room_id]["state"]["timer_task"] = asyncio.create_task(run_timer(room_id, poll_time))
                        
            elif action == "end_poll":
                if rooms[room_id]["state"]["poll"] and rooms[room_id]["state"]["poll"]["active"]:
                    rooms[room_id]["state"]["poll"]["active"] = False
                    rooms[room_id]["state"]["poll"]["status"] = "ended"
                    if rooms[room_id]["state"]["timer_task"]:
                        rooms[room_id]["state"]["timer_task"].cancel()
                    await manager.broadcast_to_room({"type": "poll_ended", "results": rooms[room_id]["state"]["poll"]}, room_id)
                    
            elif action == "toggle_chat":
                enabled = message["enabled"]
                rooms[room_id]["state"]["chat_enabled"] = enabled
                await manager.broadcast_to_room({"type": "chat_toggled", "enabled": enabled}, room_id)
                
    except WebSocketDisconnect:
        manager.disconnect_host(room_id)

@app.websocket("/ws/client/{room_id}/{client_id}")
async def websocket_client(websocket: WebSocket, room_id: str, client_id: str):
    success = await manager.connect_client(websocket, room_id)
    if not success:
        return
        
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            action = message.get("action")
            
            if action == "vote":
                state = rooms[room_id]["state"]
                if state["poll"] and state["poll"]["active"] and client_id not in state["voted_users"]:
                    option_id = message["option_id"]
                    for opt in state["poll"]["options"]:
                        if opt["id"] == option_id:
                            opt["votes"] += 1
                            state["voted_users"].add(client_id)
                            # Broadcast real-time live vote update to EVERYONE
                            await manager.broadcast_to_room({"type": "vote_update", "poll": state["poll"]}, room_id)
                            break
                            
            elif action == "chat":
                state = rooms[room_id]["state"]
                if state["chat_enabled"]:
                    msg_text = message["text"]
                    await manager.broadcast_to_room({"type": "chat_message", "client_id": client_id, "text": msg_text}, room_id)
                    
    except WebSocketDisconnect:
        manager.disconnect_client(websocket, room_id)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "../frontend")

app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
