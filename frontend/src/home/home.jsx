import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './home.css'
import { io } from 'socket.io-client'

const configuration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] },
    { urls: ["stun:global.xirsys.net"] },
    { urls: ["turn:global.xirsys.net:3478?transport=udp"] },
    { urls: ["turn:global.xirsys.net:3478?transport=tcp"] },
    { urls: ["turns:global.xirsys.net:5349?transport=tcp"] }
  ],
  username: "ahteshan",
  credential: "061c8212-7c6c-11f0-9de2-0242ac140002"
};

function Home() {
  const log = (...args) => console.log("[DEBUG]", ...args);

  let [otherusers, setOtherusers] = useState([]);
  let [currentUser, setCurrentUser] = useState({});
  let [incomingcall, setIncomingcall] = useState(false);
  let [isCalling, setIsCalling] = useState(false);
  let [userBusy, setUserBusy] = useState(false);
  let [answer, setAnswer] = useState();
  let [mute, setMute] = useState(false);
  let [pause, setPause] = useState(false);
  let [target, setTarget] = useState();
  let [inCall, setInCall] = useState(false);
  let [callReject, setCallReject] = useState(false);
  let [callEnded, setCallEnded] = useState(false);

  const location = useLocation();
  const formData = location.state?.formData;
  const localVideo = useRef();
  const localStream = useRef();
  const remoteVideo = useRef();
  const socket = useRef();
  const peerConnection = useRef();
  const navigate = useNavigate();

  useEffect(() => {
    if (!formData) {
      navigate("/");
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        log("Local stream acquired:", stream);
        localVideo.current.srcObject = stream;
        localStream.current = stream;

        socket.current = io("https://video-chat-9zhu.onrender.com/");
        socket.current.on('connect', () => {
          log("Socket connected:", socket.current.id);
          setCurrentUser({ username: formData.username, id: socket.current.id });
          socket.current.emit('new-user', { id: socket.current.id, formData });
        });

        // --- SOCKET EVENTS ---
        socket.current.on('user-joined', ({ message, members }) => {
          log("[user-joined]", message, members);
          setOtherusers(members.filter(c => c.id !== socket.current.id));
        });

        socket.current.on('welcome', ({ message, members }) => {
          log("[welcome]", message, members);
          setOtherusers(members.filter(c => c.id !== socket.current.id));
        });

        socket.current.on("user-left", ({ message, members }) => {
          log("[user-left]", message, members);
          setOtherusers(members.filter(c => c.id !== socket.current.id));
        });

        socket.current.on('offer', (payload) => {
          log("[offer received]", payload);
          if (payload.sdp) setIncomingcall(true);
          setAnswer(payload);
        });

        socket.current.on('answer', (payload) => {
          log("[answer received]", payload);
          setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }));
          setIsCalling(false);
          setInCall(true);

          peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp))
            .then(() => log("Remote description set (answer)"))
            .catch(err => log("Error setting remote description (answer):", err));
        });

        socket.current.on('ice-candidate', (payload) => {
          log("[ice-candidate received]", payload);
          if (peerConnection.current) {
            peerConnection.current.addIceCandidate(new RTCIceCandidate(payload.route))
              .then(() => log("ICE candidate added"))
              .catch(err => log("Error adding ICE candidate:", err));
          }
        });

        socket.current.on('userBusy', ({ message }) => {
          log("[userBusy]", message);
          setUserBusy(true);
          setIsCalling(false);
          setTarget(null);
        });

        socket.current.on('call_reject', () => {
          log("[call_reject]");
          setIsCalling(false);
          setCallReject(true);
        });

        socket.current.on('call_cancel', () => {
          log("[call_cancel]");
          setIncomingcall(false);
        });

        socket.current.on('call_ended', () => {
          log("[call_ended]");
          setCallEnded(true);

          if (localStream.current) localStream.current.getTracks().forEach(track => track.stop());
          if (peerConnection.current) peerConnection.current.close();

          localStream.current = null;
          setTarget(null);
          setInCall(false);
          peerConnection.current = null;
        });

        return () => {
          if (socket.current) {
            socket.current.disconnect();
            socket.current.off();
          }
        };
      })
      .catch(err => log("Error getting user media:", err));
  }, []);

  const createOffer = async ({ targetUser, user }) => {
    log("Creating offer for", targetUser, "calling", user);
    setTarget(user);
    setIsCalling(true);

    if (!localStream.current) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStream.current = stream;
      localVideo.current.srcObject = stream;
    }

    peerConnection.current = new RTCPeerConnection(configuration);

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        log("Generated ICE candidate:", event.candidate);
        socket.current.emit('ice-candidate', { target: targetUser, route: event.candidate });
      }
    };

    peerConnection.current.onconnectionstatechange = () => {
      log("Peer connection state:", peerConnection.current.connectionState);
    };

    peerConnection.current.ontrack = (event) => {
      log("Remote track received:", event.streams);
      remoteVideo.current.srcObject = event.streams[0];
    };

    localStream.current.getTracks().forEach(track => {
      log("Adding local track:", track.kind);
      peerConnection.current.addTrack(track, localStream.current);
    });

    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);
    log("Local description set (offer):", offer);

    socket.current.emit('offer', {
      sdp: offer,
      target: targetUser,
      caller: { username: currentUser.username, id: socket.current.id }
    });
  };

  const createAnswer = async ({ payload }) => {
    log("Creating answer to offer from", payload.caller);
    setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }));

    if (!localStream.current) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStream.current = stream;
      localVideo.current.srcObject = stream;
    }

    peerConnection.current = new RTCPeerConnection(configuration);

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        log("Generated ICE candidate (answer):", event.candidate);
        socket.current.emit('ice-candidate', { target: payload.caller.id, route: event.candidate });
      }
    };

    peerConnection.current.onconnectionstatechange = () => {
      log("Peer connection state:", peerConnection.current.connectionState);
    };

    peerConnection.current.ontrack = (event) => {
      log("Remote track received (answer side):", event.streams);
      remoteVideo.current.srcObject = event.streams[0];
    };

    localStream.current.getTracks().forEach(track => {
      log("Adding local track:", track.kind);
      peerConnection.current.addTrack(track, localStream.current);
    });

    await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    log("Remote description set (offer):", payload.sdp);

    const answer = await peerConnection.current.createAnswer();
    await peerConnection.current.setLocalDescription(answer);
    log("Local description set (answer):", answer);

    socket.current.emit('answer', { target: payload.caller.id, sdp: answer, caller: currentUser });
  };

  const sendAnswer = (answer) => {
    createAnswer({ payload: answer });
    setIncomingcall(false);
    setInCall(true);
    log("Call accepted");
  };



  return (// Improved JSX structure for better positioning - keeping all your logic intact
  <div className='App'>
    <header className="app-header">
      <h1>My Video Call App {currentUser.username}</h1>
    </header>
  
    <main className="main-content">
      <section className="video-section">
        <div className='video'>
          <div className="local-video-container">
            <video ref={localVideo} autoPlay muted playsInline></video>
            <div className="video-label">You</div>
          </div>
          
          <div className="remote-video-container">
            <video ref={remoteVideo} autoPlay playsInline></video>
            <div className="video-label">Remote</div>
          </div>
        </div>
        
        <div className="video-controls">
          <button className='muteBtn' onClick={handleAudio}>mute</button>
          <button className='muteBtn' onClick={handleVideo}>video</button>
          {inCall && <button className='muteBtn end-call-btn' onClick={handleEnd}>end</button>}
        </div>
      </section>
  
      <aside className="sidebar">
        <div className='list'>
          <div className="list-header">
            <p>Online Users ({otherusers.length})</p>
          </div>
          <div className="list-content">
            <ul>
              {otherusers.length > 0 ? otherusers.map(user =>
                (<li key={user.id} className="user-item">
                  <span className="user-info">
                    <span className="online-indicator"></span>
                    <span className="username">{user.username}</span>
                  </span>
                  <button className="call-btn" onClick={() => createOffer({ targetUser: user.id, user: user })}>call</button>
                </li>)
              ) : (<li className="no-users">no users online</li>)}
            </ul>
          </div>
        </div>
      </aside>
    </main>
  
    {/* All your popups with improved structure */}
    {incomingcall && 
      <div className="popup-overlay">
        <div className="popup incoming-call">
          <div className="popup-icon">📞</div>
          <h3>Incoming Call</h3>
          <p>Call from <span className="caller-name">{answer.caller.username}</span></p>
          <div className="popup-actions">
            <button className="accept-btn" onClick={() => sendAnswer(answer)}>Accept</button>
            <button className="reject-btn" onClick={handleRejectCall}>Reject</button>
          </div>
        </div>
      </div>
    }
  
    {isCalling && 
      <div className="popup-overlay">
        <div className="popup calling">
          <div className="calling-spinner"></div>
          <h3>Calling...</h3>
          <p>Calling <span className="target-name">{target.username}</span></p>
          <div className="popup-actions">
            <button className="cancel-btn" onClick={handleCancelCall}>cancel</button>
          </div>
        </div>
      </div>
    }
  
    {userBusy && 
      <div className="popup-overlay">
        <div className="popup user-busy">
          <div className="popup-icon">📵</div>
          <h3>User Busy</h3>
          <p>user busy in another call</p>
          <div className="popup-actions">
            <button className="ok-btn" onClick={() => setUserBusy(false)}>ok</button>
          </div>
        </div>
      </div>
    }
  
    {callReject && 
      <div className="popup-overlay">
        <div className="popup call-rejected">
          <div className="popup-icon">❌</div>
          <h3>Call Declined</h3>
          <p>user rejected your call</p>
          <div className="popup-actions">
            <button className="ok-btn" onClick={() => { setCallReject(false), setTarget() }}>ok</button>
            <button className="retry-btn" onClick={() => { createOffer({ targetUser: target.id, user: target }), setCallReject(false) }}>call Again</button>
          </div>
        </div>
      </div>
    }
  
    {callEnded && 
      <div className="popup-overlay">
        <div className="popup call-ended">
          <div className="popup-icon">📴</div>
          <h3>Call Ended</h3>
          <p>call ended</p>
          <div className="popup-actions">
            <button className="ok-btn" onClick={() => setCallEnded(false)}>ok</button>
          </div>
        </div>
      </div>
    }
  </div>
  );
}

export default Home;