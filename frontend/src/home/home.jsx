import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "./home.css";

/**
 * IMPORTANT: Replace the TURN credentials with your real ones.
 * Mobile-to-mobile and NATed networks almost always need TURN.
 */
const configuration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
        "stun:stun3.l.google.com:19302",
        "stun:stun4.l.google.com:19302"
      ]
    },
    {
      urls: `turns:ahteshan.webrtc.xirsys.com:443?transport=tcp`,
      username: "ahteshan",
      credential: "061c8212-7c6c-11f0-9de2-0242ac140002"
    },
    {
      urls: `turn:ahteshan.webrtc.xirsys.com:80?transport=udp`,
      username: "ahteshan",
      credential: "061c8212-7c6c-11f0-9de2-0242ac140002"
    }
  ]
};


const SOCKET_URL = "https://video-chat-9zhu.onrender.com/"; // your backend

export default function Home() {
  const [otherusers, setOtherusers] = useState([]);
  const [currentUser, setCurrentUser] = useState({});
  const [incomingcall, setIncomingcall] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [userBusy, setUserBusy] = useState(false);
  const [answerPayload, setAnswerPayload] = useState(null);
  const [mute, setMute] = useState(false);
  const [pause, setPause] = useState(false);
  const [target, setTarget] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [callReject, setCallReject] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [needsUserGesture, setNeedsUserGesture] = useState(false);

  const location = useLocation();
  const formData = location.state?.formData;
  const navigate = useNavigate();

  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const localStream = useRef(null);
  const pc = useRef(null);
  const socket = useRef(null);

  // Queue ICE candidates until remote description is set
  const pendingRemoteCandidates = useRef([]);

  // ===== Helpers =====
  const log = (...args) => console.log(...args);

  const ensureLocalStream = async () => {
    if (!localStream.current) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      localStream.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;
    }
  };

  const createPeerConnection = () => {
    if (pc.current) return pc.current;

    log("Creating RTCPeerConnection");
    const peer = new RTCPeerConnection(rtcConfig);

    peer.onicecandidate = (event) => {
      if (event.candidate && target?.id) {
        socket.current?.emit("ice-candidate", {
          target: target.id,
          route: event.candidate,
        });
        log("ICE candidate event: candidate");
      }
    };

    peer.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (remoteVideo.current && remoteStream) {
        remoteVideo.current.srcObject = remoteStream;
        tryToPlayRemote();
        log("Received remote track:", event.track.kind);
      }
    };

    peer.onconnectionstatechange = () => {
      log("Connection state:", peer.connectionState);
      if (peer.connectionState === "failed") attemptIceRestart();
    };

    peer.oniceconnectionstatechange = () => {
      log("ICE connection state:", peer.iceConnectionState);
      if (peer.iceConnectionState === "failed") attemptIceRestart();
    };

    pc.current = peer;
    return peer;
  };

  const addLocalTracks = () => {
    if (!pc.current || !localStream.current) return;
    const senders = pc.current.getSenders();
    localStream.current.getTracks().forEach((track) => {
      const already = senders.find((s) => s.track && s.track.kind === track.kind);
      if (!already) {
        pc.current.addTrack(track, localStream.current);
        log("Adding local track:", track.kind);
      }
    });
  };

  const tryToPlayRemote = async () => {
    if (!remoteVideo.current) return;
    try {
      // mobile often needs muted for autoplay
      remoteVideo.current.muted = true;
      await remoteVideo.current.play();
      // we keep it muted until user taps “Unmute”
    } catch (err) {
      log("Remote video autoplay blocked, waiting for user gesture:", err);
      setNeedsUserGesture(true);
    }
  };

  const unmuteRemote = async () => {
    if (!remoteVideo.current) return;
    try {
      remoteVideo.current.muted = false;
      await remoteVideo.current.play();
      setNeedsUserGesture(false);
    } catch (err) {
      log("Unmute attempt failed:", err);
    }
  };

  const clearPeer = () => {
    if (pc.current) {
      try {
        pc.current.getSenders().forEach((s) => s.track && s.track.stop?.());
      } catch {}
      try {
        pc.current.close();
      } catch {}
      pc.current = null;
    }
    pendingRemoteCandidates.current = [];
  };

  const cleanupMedia = () => {
    if (localStream.current) {
      localStream.current.getTracks().forEach((t) => t.stop());
      localStream.current = null;
    }
    if (localVideo.current) localVideo.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
  };

  const attemptIceRestart = async () => {
    if (!pc.current) return;
    try {
      log("Attempting ICE restart...");
      const offer = await pc.current.createOffer({ iceRestart: true });
      await pc.current.setLocalDescription(offer);
      if (target?.id && currentUser?.username) {
        socket.current?.emit("offer", {
          sdp: offer,
          target: target.id,
          caller: { username: currentUser.username, id: socket.current.id },
        });
      }
    } catch (e) {
      log("ICE restart failed:", e);
    }
  };

  // ===== Socket + lifecycle =====
  useEffect(() => {
    if (!formData) {
      navigate("/");
      return;
    }

    (async () => {
      await ensureLocalStream();

      socket.current = io(SOCKET_URL, { transports: ["websocket"] });

      socket.current.on("connect", () => {
        log("Socket connected:", socket.current.id);
        setCurrentUser({ username: formData.username, id: socket.current.id });
        socket.current.emit("new-user", { id: socket.current.id, formData });
      });

      socket.current.on("user-joined", ({ message, members }) => {
        log("User joined:", message);
        setOtherusers(members.filter((m) => m.id !== socket.current.id));
      });

      socket.current.on("welcome", ({ message, members }) => {
        log("Welcome received, members:", members);
        setOtherusers(members.filter((m) => m.id !== socket.current.id));
      });

      socket.current.on("user-left", ({ message, members }) => {
        log("User left:", message);
        setOtherusers(members.filter((m) => m.id !== socket.current.id));
      });

      socket.current.on("offer", (payload) => {
        log(`Incoming offer from ${payload?.caller?.id} to ${payload?.target}`);
        if (!payload?.sdp) return;
        setIncomingcall(true);
        setAnswerPayload(payload);
      });

      socket.current.on("answer", async (payload) => {
        try {
          log("Received answer:", payload);
          setCurrentUser((prev) => ({ ...prev, partner: payload.caller.id }));
          setIsCalling(false);
          setInCall(true);

          if (!pc.current) createPeerConnection();

          await pc.current.setRemoteDescription(
            new RTCSessionDescription(payload.sdp)
          );
          log("Remote description set for answer");

          while (pendingRemoteCandidates.current.length) {
            const cand = pendingRemoteCandidates.current.shift();
            try {
              await pc.current.addIceCandidate(cand);
              log("Added queued ICE candidate");
            } catch (e) {
              log("Failed to add queued candidate:", e);
            }
          }
        } catch (e) {
          log("Error handling answer:", e);
        }
      });

      socket.current.on("userBusy", ({ message }) => {
        setUserBusy(true);
        setIsCalling(false);
        setTarget(null);
        log(message);
      });

      socket.current.on("call_reject", () => {
        setIsCalling(false);
        setCallReject(true);
        log("Call rejected");
      });

      socket.current.on("call_cancel", () => {
        setIncomingcall(false);
        setAnswerPayload(null);
        log("Caller canceled");
      });

      socket.current.on("call_ended", () => {
        log("Call ended (remote)");
        setCallEnded(true);
        setInCall(false);
        setTarget(null);
        setNeedsUserGesture(false);
        clearPeer();
        cleanupMedia();
      });

      socket.current.on("ice-candidate", async (payload) => {
        const candidate = new RTCIceCandidate(payload.route);
        if (pc.current && pc.current.remoteDescription) {
          try {
            await pc.current.addIceCandidate(candidate);
            log("ICE candidate added successfully");
          } catch (e) {
            log("Failed to add ICE candidate:", e);
          }
        } else {
          pendingRemoteCandidates.current.push(candidate);
          log("ICE candidate queued");
        }
      });
    })();

    return () => {
      try {
        socket.current?.off();
        socket.current?.disconnect();
      } catch {}
      clearPeer();
      cleanupMedia();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Actions =====
  const createOffer = async ({ targetUser, user }) => {
    try {
      log("Creating offer for user:", user.username);
      setTarget(user);
      setIsCalling(true);

      await ensureLocalStream();
      createPeerConnection();
      addLocalTracks();

      const offer = await pc.current.createOffer();
      await pc.current.setLocalDescription(offer);
      log("Local description set, sending offer");

      socket.current.emit("offer", {
        sdp: offer,
        target: targetUser,
        caller: { username: currentUser.username, id: socket.current.id },
      });
    } catch (e) {
      log("Failed to create/send offer:", e);
      setIsCalling(false);
    }
  };

  const createAnswer = async (payload) => {
    try {
      setCurrentUser((prev) => ({ ...prev, partner: payload.caller.id }));
      await ensureLocalStream();
      createPeerConnection();
      addLocalTracks();

      await pc.current.setRemoteDescription(
        new RTCSessionDescription(payload.sdp)
      );
      const answer = await pc.current.createAnswer();
      await pc.current.setLocalDescription(answer);

      socket.current.emit("answer", {
        target: payload.caller.id,
        sdp: answer,
        caller: { username: currentUser.username, id: socket.current.id },
      });

      setInCall(true);

      while (pendingRemoteCandidates.current.length) {
        const cand = pendingRemoteCandidates.current.shift();
        try {
          await pc.current.addIceCandidate(cand);
          log("Added queued ICE candidate");
        } catch (e) {
          log("Failed to add queued candidate:", e);
        }
      }
    } catch (e) {
      log("Failed to create/send answer:", e);
    }
  };

  const sendAnswer = () => {
    if (!answerPayload) return;
    setIncomingcall(false);
    createAnswer(answerPayload);
    setAnswerPayload(null);
    log("Call accepted");
  };

  const handleAudio = () => {
    if (!localStream.current) return;
    const audios = localStream.current.getAudioTracks();
    if (!audios.length) return;
    const enabled = !mute;
    audios.forEach((t) => (t.enabled = !enabled));
    setMute(!mute);
  };

  const handleVideo = () => {
    if (!localStream.current) return;
    const videos = localStream.current.getVideoTracks();
    if (!videos.length) return;
    const enabled = !pause;
    videos.forEach((t) => (t.enabled = !enabled));
    setPause(!pause);
  };

  const handleCancelCall = () => {
    setIsCalling(false);
    if (target) {
      socket.current.emit("call_canceled", {
        target,
        caller: socket.current.id,
      });
    }
    setTarget(null);
  };

  const handleRejectCall = () => {
    setIncomingcall(false);
    if (answerPayload?.caller?.id) {
      socket.current.emit("call_reject", {
        targetUser: answerPayload.caller.id,
        callee: socket.current.id,
      });
    }
    setAnswerPayload(null);
  };

  const handleEnd = () => {
    if (currentUser?.partner) {
      socket.current.emit("call_ended", {
        target: currentUser.partner,
        currentUser: currentUser.id,
      });
    }
    setTarget(null);
    setInCall(false);
    setCallEnded(true);
    setNeedsUserGesture(false);

    clearPeer();
    cleanupMedia();
  };

  // ===== Render =====
  return (
    <div className="App">
      <header className="app-header">
        <h1>My Video Call App {currentUser.username}</h1>
      </header>

      <main className="main-content">
        <section className="video-section">
          <div className="video">
            <div className="local-video-container">
              <video
                ref={localVideo}
                autoPlay
                muted
                playsInline
                disablePictureInPicture
              />
              <div className="video-label">You</div>
            </div>

            <div className="remote-video-container">
              <video
                ref={remoteVideo}
                autoPlay
                playsInline
                disablePictureInPicture
              />
              <div className="video-label">Remote</div>

              {needsUserGesture && (
                <div className="tap-to-unmute">
                  <button onClick={unmuteRemote}>Tap to unmute audio</button>
                </div>
              )}
            </div>
          </div>

          <div className="video-controls">
            <button className="muteBtn" onClick={handleAudio}>
              {mute ? "unmute" : "mute"}
            </button>
            <button className="muteBtn" onClick={handleVideo}>
              {pause ? "video on" : "video off"}
            </button>
            {inCall && (
              <button className="muteBtn end-call-btn" onClick={handleEnd}>
                end
              </button>
            )}
          </div>
        </section>

        <aside className="sidebar">
          <div className="list">
            <div className="list-header">
              <p>Online Users ({otherusers.length})</p>
            </div>
            <div className="list-content">
              <ul>
                {otherusers.length > 0 ? (
                  otherusers.map((user) => (
                    <li key={user.id} className="user-item">
                      <span className="user-info">
                        <span className="online-indicator"></span>
                        <span className="username">{user.username}</span>
                      </span>
                      <button
                        className="call-btn"
                        onClick={() =>
                          createOffer({ targetUser: user.id, user })
                        }
                      >
                        call
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="no-users">no users online</li>
                )}
              </ul>
            </div>
          </div>
        </aside>
      </main>

      {/* Popups */}
      {incomingcall && (
        <div className="popup-overlay">
          <div className="popup incoming-call">
            <div className="popup-icon">📞</div>
            <h3>Incoming Call</h3>
            <p>
              Call from{" "}
              <span className="caller-name">{answerPayload?.caller?.username}</span>
            </p>
            <div className="popup-actions">
              <button className="accept-btn" onClick={sendAnswer}>
                Accept
              </button>
              <button className="reject-btn" onClick={handleRejectCall}>
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {isCalling && (
        <div className="popup-overlay">
          <div className="popup calling">
            <div className="calling-spinner"></div>
            <h3>Calling...</h3>
            <p>
              Calling <span className="target-name">{target?.username}</span>
            </p>
            <div className="popup-actions">
              <button className="cancel-btn" onClick={handleCancelCall}>
                cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {userBusy && (
        <div className="popup-overlay">
          <div className="popup user-busy">
            <div className="popup-icon">📵</div>
            <h3>User Busy</h3>
            <p>user busy in another call</p>
            <div className="popup-actions">
              <button className="ok-btn" onClick={() => setUserBusy(false)}>
                ok
              </button>
            </div>
          </div>
        </div>
      )}

      {callReject && (
        <div className="popup-overlay">
          <div className="popup call-rejected">
            <div className="popup-icon">❌</div>
            <h3>Call Declined</h3>
            <p>user rejected your call</p>
            <div className="popup-actions">
              <button
                className="ok-btn"
                onClick={() => {
                  setCallReject(false);
                  setTarget(null);
                }}
              >
                ok
              </button>
              {target && (
                <button
                  className="retry-btn"
                  onClick={() => {
                    createOffer({ targetUser: target.id, user: target });
                    setCallReject(false);
                  }}
                >
                  call Again
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {callEnded && (
        <div className="popup-overlay">
          <div className="popup call-ended">
            <div className="popup-icon">📴</div>
            <h3>Call Ended</h3>
            <p>call ended</p>
            <div className="popup-actions">
              <button className="ok-btn" onClick={() => setCallEnded(false)}>
                ok
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
