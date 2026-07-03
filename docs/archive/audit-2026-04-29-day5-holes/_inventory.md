# FE ↔ BE Contract Surface Inventory
**Audit:** 2026-04-29 Day-5  
**Generated:** Comprehensive inventory of all API routes, WebSocket events, Pydantic models, TypeScript types, FE service callers, and Zustand stores.

---

## 1. FastAPI Routes

| METHOD | PATH | HANDLER | FILE:LINE | AUTH |
|--------|------|---------|-----------|------|
| POST | /auth/login/rfid | login_rfid | routes_auth.py:187 | None |
| POST | /auth/login/pin | login_pin | routes_auth.py:221 | None |
| POST | /auth/refresh | refresh | routes_auth.py:284 | None |
| GET | /auth/config | get_auth_config | routes_auth.py:371 | None |
| GET | /auth/me | get_me | routes_auth.py:382 | Require |
| POST | /auth/logout | logout | routes_auth.py:388 | Require |
| GET | /auth/users/picker | list_users_picker | routes_auth.py:398 | None |
| POST | /chat/message | send_message | routes_chat.py:495 | Require |
| GET | /chat/sessions | list_sessions | routes_chat.py:1002 | Require |
| GET | /chat/sessions/{session_id}/messages | get_messages | routes_chat.py:1030 | Require |
| DELETE | /chat/sessions/{session_id} | delete_session | routes_chat.py:1055 | Require |
| GET | /context/current | get_current_context | routes_context.py:14 | Require |
| GET | /context/history | get_context_history | routes_context.py:22 | Require |
| GET | /context/state | get_state | routes_context.py:35 | Require |
| POST | /agent/task | start_task | routes_agent.py:53 | Require |
| POST | /agent/task/{task_id}/pause | pause_task | routes_agent.py:70 | Require |
| POST | /agent/task/{task_id}/resume | resume_task | routes_agent.py:76 | Require |
| POST | /agent/task/{task_id}/intervene | intervene_task | routes_agent.py:82 | Require |
| POST | /agent/task/{task_id}/cancel_step | cancel_step | routes_agent.py:92 | Require |
| POST | /agent/stop | stop_task | routes_agent.py:98 | Require |
| POST | /agent/task/{task_id}/checkpoint | create_checkpoint | routes_agent.py:104 | Require |
| POST | /agent/task/{task_id}/resume_from_checkpoint | resume_from_checkpoint | routes_agent.py:112 | Require |
| GET | /agent/tasks | list_tasks | routes_agent.py:129 | Require |
| GET | /agent/task/{task_id} | get_task | routes_agent.py:139 | Require |
| GET | /agent/audit | get_audit | routes_agent.py:155 | Require |
| GET | /agent/status | get_agent_status | routes_agent.py:165 | Require |
| GET | /agent/router_state | get_router_state | routes_agent.py:201 | Require |
| GET | /agent/self_model | get_self_model | routes_agent.py:212 | Require |
| POST | /agent/feedback | submit_feedback | routes_agent.py:223 | Require |
| POST | /agent/standing_orders | create_standing_order | routes_agent.py:267 | Require |
| GET | /agent/standing_orders | list_standing_orders | routes_agent.py:321 | Require |
| PATCH | /agent/standing_orders/{order_id} | patch_standing_order | routes_agent.py:338 | Require |
| DELETE | /agent/standing_orders/{order_id} | delete_standing_order | routes_agent.py:375 | Require |
| POST | /linux/execute | execute_command | routes_linux.py:25 | Require |
| GET | /linux/resources | get_resources | routes_linux.py:71 | Require |
| GET | /hub/providers | list_providers | routes_hub.py:85 | Require |
| GET | /hub/route_state | get_route_state | routes_hub.py:97 | Require |
| POST | /voice/stt | transcribe_speech | routes_voice.py:83 | Require |
| POST | /voice/tts | synthesize_speech | routes_voice.py:143 | Require |
| GET | /voice/status | voice_status | routes_voice.py:191 | Require |
| GET | /face/enroll | face_enroll | routes_face.py:121 | Require |
| POST | /face/recognize | face_recognize | routes_face.py:144 | Require |
| DELETE | /face/embedding | face_delete | routes_face.py:174 | Require |
| GET | /face/status | face_status | routes_face.py:185 | Require |
| GET | /face/me | face_me | routes_face.py:210 | Require |
| GET | /dynamic_source/{source} | get_dynamic_source | routes_dynamic_source.py:236 | Require |
| GET | /ai/models | list_ollama_models | routes_ai.py:56 | Require |
| POST | /ai/test | test_provider | routes_ai.py:91 | Require |
| GET | /map/wardriving | get_wardriving | routes_map.py:146 | Require |
| GET | /map/heatmap | get_heatmap | routes_map.py:183 | Require |
| GET | /map/pois | get_pois | routes_map.py:205 | Require |
| POST | /map/pois | create_poi | routes_map.py:234 | Require |
| DELETE | /map/pois/{poi_id} | delete_poi | routes_map.py:262 | Require |
| POST | /map/geolocation/submit | submit_geolocation | routes_map.py:279 | Require |
| GET | /map/location_history | get_location_history | routes_map.py:315 | Require |
| GET | /map/nearby | get_nearby | routes_map.py:363 | Require |
| GET | /map/geo_tagged_facts | get_geo_tagged_facts | routes_map.py:432 | Require |
| GET | /map/track | get_track | routes_map.py:451 | Require |
| GET | /map/services_health | get_services_health | routes_map.py:491 | None |
| GET | /settings | get_all_settings | routes_settings.py:494 | Require |
| GET | /settings/_value/{key:path} | get_setting | routes_settings.py:501 | Require |
| PUT | /settings/{key:path} | set_setting | routes_settings.py:511 | Require |
| POST | /settings/reset | reset_settings | routes_settings.py:662 | Require |
| POST | /settings/export | export_settings | routes_settings.py:698 | Require |
| POST | /settings/import | import_settings | routes_settings.py:715 | Require |
| POST | /users/{user_id}/facts | create_fact | routes_user_facts.py:146 | Require |
| GET | /users/{user_id}/facts | list_facts | routes_user_facts.py:182 | Require |
| GET | /users/{user_id}/facts/{fact_id} | get_fact | routes_user_facts.py:197 | Require |
| PUT | /users/{user_id}/facts/{fact_id} | update_fact | routes_user_facts.py:218 | Require |
| DELETE | /users/{user_id}/facts/{fact_id} | delete_fact | routes_user_facts.py:259 | Require |
| POST | /tools/timer | api_create_timer | routes_tools.py:38 | Require |
| GET | /tools/timer | api_get_timers | routes_tools.py:48 | Require |
| POST | /tools/alarm | api_create_alarm | routes_tools.py:60 | Require |
| GET | /tools/alarm | api_get_alarms | routes_tools.py:70 | Require |
| GET | /tools/calendar | api_get_calendar | routes_tools.py:82 | Require |
| POST | /tools/calendar/events | api_create_event | routes_tools.py:98 | Require |

**Total FastAPI routes: 76**

---

## 2. WebSocket Routes

| PATH | HANDLER/REGISTRATION | FILE:LINE | CONTRACT |
|------|----------------------|-----------|----------|
| /ws | broadcast hub (sensor, snapshot, agent_event, etc.) | main.py:792 | General broadcast hub |
| /ws/voice | register_voice_ws | routes_voice_stream.py | Voice always-on streaming; binary + JSON text cmds |

---

## 3. WebSocket Event Types

| EVENT_TYPE | DIRECTION | EMITTED_BY | CONSUMED_BY |
|-----------|-----------|-----------|------------|
| snapshot | BE→FE | main.py:90 (hub.broadcast "sensor") | WebSocketContext (FE) |
| state.transition | BE→FE | main.py:77 (event_bus.emit) | StateTransitionEvent → dispatch |
| agent_event | BE→FE | agent/proactive.py:257,371,406,651 (hub.broadcast) | agentStore WS listener |
| wake | BE→FE | routes_voice_stream.py:170 (orchestrator event) | voice WS client |
| speech_start | BE→FE | routes_voice_stream.py:172 (orchestrator event) | voice WS client |
| speech_end | BE→FE | routes_voice_stream.py:174 (orchestrator event) | voice WS client |
| final | BE→FE | routes_voice_stream.py:174 (orchestrator event) | voice WS client |
| rejected | BE→FE | routes_voice_stream.py:174 (orchestrator event) | voice WS client |
| cooldown_end | BE→FE | routes_voice_stream.py:174 (orchestrator event) | voice WS client |
| ready | BE→FE | routes_voice_stream.py (orchestrator init) | voice WS client (sample_rate, frame_size) |
| config | BE→FE | routes_voice_stream.py:235 (set_confidence cmd echo) | voice WS client (confidence_min, continuation_window_s) |
| error | BE→FE | routes_voice_stream.py:193,197,201,223 (handle_command) | voice WS client |
| reset_ack | BE→FE | routes_voice_stream.py:206 (reset cmd) | voice WS client |
| mic_duck_ack | BE→FE | routes_voice_stream.py:210,213 (mic_duck/unduck) | voice WS client (ducked flag) |
| stopped | BE→FE | routes_voice_stream.py:242 (stop cmd) | voice WS client |

**Voice WS client commands (FE→BE):**
- `{"cmd": "reset"}` — reset orchestrator
- `{"cmd": "mic_duck"}` — mute on TTS start
- `{"cmd": "mic_unduck"}` — unmute on TTS end
- `{"cmd": "set_confidence", "value": float}` — tune wake threshold
- `{"cmd": "stop"}` — close WS
- `{"cmd": "client_speech_start"}` — frontend VAD signal (logged)

**Total WS event types: 15 BE→FE types + 6 FE→BE commands**

---

## 4. Pydantic Models (Request/Response)

| MODEL_NAME | FILE:LINE | USED_IN_ROUTES |
|------------|-----------|----------------|
| RFIDLoginRequest | routes_auth.py:64 | login_rfid |
| PINLoginRequest | routes_auth.py:68 | login_pin |
| AuthResponse | routes_auth.py:73 | login_rfid, login_pin |
| RefreshResponse | routes_auth.py:79 | refresh |
| CreateUserRequest | routes_auth.py:84 | (auth user mgmt) |
| UpdateUserRequest | routes_auth.py:91 | (auth user mgmt) |
| SetRoleRequest | routes_auth.py:98 | (auth user mgmt) |
| SendMessageRequest | routes_chat.py:39 | send_message |
| StartTaskRequest | routes_agent.py:29 | start_task |
| InterveneRequest | routes_agent.py:33 | intervene_task |
| StopRequest | routes_agent.py:37 | stop_task |
| ResumeFromCheckpointRequest | routes_agent.py:41 | resume_from_checkpoint |
| FeedbackRequest | routes_agent.py:45 | submit_feedback |
| StandingOrderCreate | routes_agent.py:235 | create_standing_order |
| StandingOrderPatch | routes_agent.py:243 | patch_standing_order |
| ExecuteRequest | routes_linux.py:19 | execute_command |
| ProviderRow | routes_hub.py:39 | list_providers response |
| HubProvidersResponse | routes_hub.py:52 | list_providers |
| HubRouteStateResponse | routes_hub.py:57 | get_route_state |
| TTSRequest | routes_voice.py:42 | synthesize_speech |
| STTResponse | routes_voice.py:49 | transcribe_speech |
| StatusResponse (voice) | routes_voice.py:62 | voice_status |
| EnrollRequest | routes_face.py:46 | face_enroll |
| EnrollResponse | routes_face.py:53 | face_enroll |
| RecognizeRequest | routes_face.py:60 | face_recognize |
| RecognizeResponse | routes_face.py:64 | face_recognize |
| StatusResponse (face) | routes_face.py:73 | face_status |
| OllamaModel | routes_ai.py:29 | list_ollama_models response |
| ModelsResponse | routes_ai.py:37 | list_ollama_models |
| TestRequest | routes_ai.py:44 | test_provider |
| TestResponse | routes_ai.py:48 | test_provider |
| POICreate | routes_map.py:42 | create_poi |
| GeolocationSubmit | routes_map.py:52 | submit_geolocation |
| DynamicPickerOption | routes_dynamic_source.py:56 | get_dynamic_source response |
| DynamicPickerResponse | routes_dynamic_source.py:64 | get_dynamic_source |
| SettingDefinitionOut | routes_settings.py:41 | get_all_settings response |
| SettingsCategoryOut | routes_settings.py:58 | get_all_settings response |
| CategoriesResponse | routes_settings.py:65 | get_all_settings |
| SetValueRequest | routes_settings.py:69 | set_setting |
| ResetRequest | routes_settings.py:73 | reset_settings |
| ImportRequest | routes_settings.py:77 | import_settings |
| FactCreate | routes_user_facts.py:52 | create_fact |
| FactUpdate | routes_user_facts.py:58 | update_fact |
| FactRow | routes_user_facts.py:65 | create_fact, update_fact response |
| FactsListResponse | routes_user_facts.py:99 | list_facts |
| TimerCreate | routes_tools.py:18 | api_create_timer |
| AlarmCreate | routes_tools.py:23 | api_create_alarm |
| CalendarEventCreate | routes_tools.py:29 | api_create_event |

**Total Pydantic models: 47**

---

## 5. TypeScript Shared Types

| TYPE_NAME | FILE:LINE | BE_PYDANTIC_MATCH |
|-----------|-----------|-------------------|
| ResponseForm | chat.ts:3 | No (enum only) |
| SceneKind | chat.ts:31 | No (closed ADR-CS-002) |
| RevealPolicy | chat.ts:40 | No (UI-only) |
| SceneReveal | chat.ts:42 | No (UI-only) |
| ScenePanelKind | chat.ts:49 | No (UI-only) |
| ScenePanel | chat.ts:57 | Partial (scene attachment) |
| ChatScene | chat.ts:115 | Partial (scene payload) |
| ChatMessage | chat.ts:121 | Partial (serialized) |
| ChatAttachment | chat.ts:150 | Partial (attachments_json) |
| ChatSession | chat.ts:160 | Partial (session model) |
| DynamicPickerSource | chat.ts:180 | No (UI enum) |
| DynamicPickerOption | chat.ts:187 | Yes (DynamicPickerOption) |
| DynamicPickerProps | chat.ts:194 | No (UI component) |
| WardrivingRecord | wardriving.ts:1 | Yes (wardriving route response) |
| MapPOI | wardriving.ts:15 | Yes (map POI model) |
| HeatmapPoint | wardriving.ts:28 | Yes (heatmap route) |
| TrackPoint | wardriving.ts:36 | Yes (track route) |
| MemoryFact | memory.ts:3 | Yes (fact models) |
| TemporalAnchor | memory.ts:26 | Partial (metadata) |
| SettingsCategory | settings.ts:3 | Yes (SettingsCategoryOut) |
| SettingDefinition | settings.ts:10 | Yes (SettingDefinitionOut) |
| AgentSubstate | agent.ts:7 | Yes (agent.status response) |
| AgentTaskStatus | agent.ts:18 | Yes (agent audit) |
| AgentSubGoalStatus | agent.ts:30 | Yes (agent subgoals) |
| AgentObservationType | agent.ts:37 | Yes (agent audit) |
| AgentReflectionVerdict | agent.ts:45 | Yes (agent audit) |
| AgentTrack | agent.ts:52 | Yes (agent status) |
| AgentRiskLevel | agent.ts:54 | No (internal) |
| AgentInnerMonologue | agent.ts:56 | Partial (audit entry) |
| AgentSubGoal | agent.ts:65 | Yes (agent task detail) |
| AgentPlanStep | agent.ts:75 | Partial (audit) |
| AgentObservation | agent.ts:86 | Partial (audit) |
| AgentActionResult | agent.ts:96 | Partial (audit) |
| AgentEmotionVector | agent.ts:106 | Yes (self_model) |
| AgentSelfModel | agent.ts:119 | Yes (agent/self_model route) |
| AgentThoughtBudget | agent.ts:134 | Yes (agent task) |
| AgentReflectionResult | agent.ts:141 | Partial (audit) |
| AgentTaskSummary | agent.ts:150 | Yes (list_tasks response) |
| AgentAuditEntry | agent.ts:161 | Yes (get_audit response) |
| AgentTaskDetail | agent.ts:177 | Yes (get_task response) |
| AgentEventType | agent.ts:188 | Yes (WS broadcast) |
| AgentEvent | agent.ts:226 | Yes (WS agent_event) |
| UserRole | user.ts:1 | Yes (User.role) |
| User | user.ts:3 | Yes (auth response) |
| UserPreferences | user.ts:16 | Yes (User.preferences) |
| BehavioralModel | user.ts:34 | Partial (user.behavioral_model_json) |
| ActuatorCommand | commands.ts:1 | No (deprecated) |
| SensorBatch | sensors.ts:1 | Yes (ESP32 stream) |
| SensorError | sensors.ts:56 | Yes (ESP32 stream) |
| SensorHeartbeat | sensors.ts:65 | Yes (ESP32 stream) |
| ESP32Message | sensors.ts:74 | Yes (ESP32 union) |
| ContextSnapshot | context.ts:3 | Yes (context routes) |
| SystemState | system.ts:11 | Yes (state machine) |
| StateTransition | system.ts | Yes (state transition event) |

**Total TypeScript types: 58**

---

## 6. FE Service Callers (API functions in `services/api.ts` and specialized services)

### authApi
| FN_NAME | METHOD+PATH | FILE:LINE |
|---------|-------------|-----------|
| loginRfid | POST /auth/login/rfid | api.ts:76 |
| loginPin | POST /auth/login/pin | api.ts:78 |
| refresh | POST /auth/refresh | api.ts:80 |
| me | GET /auth/me | api.ts:81 |
| logout | POST /auth/logout | api.ts:82 |
| config | GET /auth/config | api.ts:83 |
| picker | GET /auth/users/picker | api.ts:91 |

### chatApi
| FN_NAME | METHOD+PATH | FILE:LINE |
|---------|-------------|-----------|
| sendMessage | POST /chat/message | api.ts:107 |
| getSessions | GET /chat/sessions | api.ts:109 |
| getMessages | GET /chat/sessions/{sessionId}/messages | api.ts:114 |
| deleteSession | DELETE /chat/sessions/{sessionId} | api.ts:116 |

### contextApi
| FN_NAME | METHOD+PATH | FILE:LINE |
|---------|-------------|-----------|
| current | GET /context/current | api.ts:123 |
| history | GET /context/history | api.ts:124 |
| state | GET /context/state | api.ts:129 |

### voiceApi
| FN_NAME | METHOD+PATH | FILE:LINE |
|---------|-------------|-----------|
| tts | POST /voice/tts | api.ts:150 |
| stt | POST /voice/stt | api.ts:166 |

### settingsApi
| FN_NAME | METHOD+PATH | FILE:LINE |
|---------|-------------|-----------|
| getAll | GET /settings | api.ts:188 |
| get | GET /settings/{key} | api.ts:189 |
| set | PUT /settings/{key} | api.ts:191 |
| reset | POST /settings/reset | api.ts:197 |
| export | POST /settings/export | api.ts:201 |
| import | POST /settings/import | api.ts:203 |

### mapApi
| FN_NAME | METHOD+PATH | FILE:LINE |
|---------|-------------|-----------|
| getWardriving | GET /map/wardriving | api.ts:219 |
| getHeatmap | GET /map/heatmap | api.ts:229 |
| getPOIs | GET /map/pois | api.ts:235 |
| createPOI | POST /map/pois | api.ts:239 |
| deletePOI | DELETE /map/pois/{id} | api.ts:241 |
| getTrack | GET /map/track | api.ts:243 |
| getLocationHistory | GET /map/location_history | api.ts:245 |
| getNearby | GET /map/nearby | api.ts:255 |
| getServicesHealth | GET /map/services_health | api.ts:263 |
| getGeoTaggedFacts | GET /map/geo_tagged_facts | api.ts:266 |

### linuxApi
| FN_NAME | METHOD+PATH | FILE:LINE |
|---------|-------------|-----------|
| execute | POST /linux/execute | api.ts:368 |
| resources | GET /linux/resources | api.ts:370 |

### aiApi
| FN_NAME | METHOD+PATH | FILE:LINE |
|---------|-------------|-----------|
| listModels | GET /ai/models | api.ts:408 |
| test | POST /ai/test | api.ts:409 |

### toolsApi
| FN_NAME | METHOD+PATH | FILE:LINE |
|---------|-------------|-----------|
| createTimer | POST /tools/timer | api.ts:416 |
| createAlarm | POST /tools/alarm | api.ts:418 |
| getCalendar | GET /tools/calendar | api.ts:420 |
| createEvent | POST /tools/calendar/events | api.ts:422 |

### agentApi (`services/agentApi.ts`)
| FN_NAME | METHOD+PATH | FILE:LINE |
|---------|-------------|-----------|
| startTask | POST /agent/task | agentApi.ts:75+ |
| pauseTask | POST /agent/task/{id}/pause | agentApi.ts |
| resumeTask | POST /agent/task/{id}/resume | agentApi.ts |
| interveneTask | POST /agent/task/{id}/intervene | agentApi.ts |
| cancelStep | POST /agent/task/{id}/cancel_step | agentApi.ts |
| stopTask | POST /agent/stop | agentApi.ts |
| getTasks | GET /agent/tasks | agentApi.ts |
| getTask | GET /agent/task/{id} | agentApi.ts |
| getStatus | GET /agent/status | agentApi.ts |
| feedback | POST /agent/feedback | agentApi.ts |

### faceApi (`services/faceApi.ts`)
| FN_NAME | METHOD+PATH | FILE:LINE |
|---------|-------------|-----------|
| enroll | POST /face/enroll | faceApi.ts:61+ |
| recognize | POST /face/recognize | faceApi.ts |
| status | GET /face/status | faceApi.ts |

### voiceApi (`services/voiceApi.ts`)
| FN_NAME | METHOD+PATH | FILE:LINE |
|---------|-------------|-----------|
| stt | POST /voice/stt | voiceApi.ts:46+ |
| tts | POST /voice/tts | voiceApi.ts |
| status | GET /voice/status | voiceApi.ts |

**Total FE service callers: 59**

---

## 7. Zustand Stores

| STORE | STATE_FIELDS | FILE |
|-------|--------------|------|
| useChatStore | sessions, currentSessionId, messages, streaming, isTyping, loading, sending, error, userPreview | chatStore.ts |
| useAuthStore | user, token, expiresAt, isAuthenticated, isLoading, error, currentProfile | authStore.ts |
| useSystemStore | state, previousState, since, transitions, isLoadingState | systemStore.ts |
| useUiStore | activeLayout, sidebarOpen, debugMode, selectedMessage, notification | uiStore.ts |
| useSettingsStore | categories, loading, error, values, requiresRestart | settingsStore.ts |
| useAgentStore | foregroundTask, backgroundTask, foregroundSubstate, backgroundSubstate, queueSizeFg, queueSizeBg, selfModel, events | agentStore.ts |
| useMapStore | selectedMarker, mapBounds, trackPoints, pois, heatmapPoints, selectedPoi, wardrivingRecords | mapStore.ts |
| useFaceStore | enrolledFaceId, recognized, confidence, status, isLoading, error | faceStore.ts |
| useInputModeStore | mode, isListening, isProcessing | inputModeStore.ts |
| useVoiceAlwaysOnStatusStore | enabled, isListening, confidence, transcript | voiceAlwaysOnStatusStore.ts |
| useOledStore | pattern, brightness, animation, isActive | oledStore.ts |

**Total Zustand stores: 11**

---

## Summary Tally

- **FastAPI routes:** 76
- **WebSocket routes:** 2 (/ws, /ws/voice)
- **WebSocket event types:** 15 BE→FE + 6 FE→BE commands
- **Pydantic models:** 47
- **TypeScript shared types:** 58
- **FE service callers:** 59 functions across 12 service modules
- **Zustand stores:** 11

**Grand totals:**
- Routes (REST): 76
- Routes (WebSocket): 2
- Models (BE): 47
- Types (FE): 58
- Callers (FE): 59
- Stores (FE): 11

