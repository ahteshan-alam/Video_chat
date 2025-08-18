import 'webrtc-adapter'; // For browser compatibility
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './home.css'
import { io } from 'socket.io-client'

// Configuration with STUN and TURN servers for reliability
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    }
  ],
};

function Home() {
  const [otherusers, setOtherusers] = useState([]);
  const [currentUser, setCurrentUser] = useState({});
  const [incomingcall, setIncomingcall] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [userBusy, setUserBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [mute, setMute] = useState(false);
  const [pause, setPause] = useState(false);
  const [target, setTarget] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [callReject, setCallReject] = useState(false);
  const [callEnded, setCallEnded] = useState(false);

  const location = useLocation();
  const formData = location.state?.formData;
  const localVideo = useRef();
  const localStream = useRef();
  const remoteVideo = useRef();
  const socket = useRef();
  const peerConnection = useRef();
  const iceCandidateQueue = useRef([]); // Queue for early ICE candidates
  const navigate = useNavigate();

  useEffect(() => {
    if (!formData) {
      navigate("/");
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localVideo.current.srcObject = stream;
        localStream.current = stream;
        
        // Initialize Socket.IO connection
        socket.current = io("https://video-chat-9zhu.onrender.com/"); // Use your backend URL

        // --- Socket Event Handlers ---
        socket.current.on('connect', () => {
          setCurrentUser({ username: formData.username, id: socket.current.id });
          socket.current.emit('new-user', { id: socket.current.id, formData });
        });

        socket.current.on('user-joined', ({ members }) => {
          setOtherusers(members.filter((client) => client.id !== socket.current.id));
        });

        socket.current.on('welcome', ({ members }) => {
          setOtherusers(members.filter((client) => client.id !== socket.current.id));
        });

        socket.current.on("user-left", ({ members }) => {
          setOtherusers(members.filter(client => client.id !== socket.current.id));
        });

        socket.current.on('offer', (payload) => {
          if (payload.sdp) {
            setIncomingcall(true);
          }
          setAnswer(payload);
        });

        socket.current.on('userBusy', () => {
          setUserBusy(true);
          setIsCalling(false);
          setTarget(null);
        });

        // ** CRITICAL FIX **: Handle incoming answer and process ICE queue
        socket.current.on('answer', async (payload) => {
          if (peerConnection.current && !peerConnection.current.remoteDescription) {
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            
            // Process any queued candidates
            iceCandidateQueue.current.forEach(candidate => {
              peerConnection.current.addIceCandidate(candidate);
            });
            iceCandidateQueue.current = []; // Clear the queue

            setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }));
            setIsCalling(false);
            setInCall(true);
          }
        });

        // ** CRITICAL FIX **: Queue ICE candidates if they arrive early
        socket.current.on('ice-candidate', (payload) => {
          const candidate = new RTCIceCandidate(payload.route);
          if (peerConnection.current && peerConnection.current.remoteDescription) {
            peerConnection.current.addIceCandidate(candidate);
          } else {
            iceCandidateQueue.current.push(candidate);
          }
        });

        socket.current.on('call_reject', () => {
          setIsCalling(false);
          setCallReject(true);
        });

        socket.current.on('call_cancel', () => {
          setIncomingcall(false);
        });

        socket.current.on('call_ended', () => {
          handleCallCleanup();
          setCallEnded(true);
        });

      });
      
    return () => {
      if (socket.current) {
        socket.current.disconnect();
      }
      if (localStream.current) {
        localStream.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const createPeerConnection = () => {
    peerConnection.current = new RTCPeerConnection(configuration);
    iceCandidateQueue.current = []; // Reset queue for new connection

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        const targetId = target?.id || answer?.caller?.id;
        if (targetId) {
          socket.current.emit('ice-candidate', { target: targetId, route: event.candidate });
        }
      }
    };

    peerConnection.current.ontrack = (event) => {
      remoteVideo.current.srcObject = event.streams[0];
    };

    localStream.current.getTracks().forEach(track => {
      peerConnection.current.addTrack(track, localStream.current);
    });
  };

  const createOffer = async ({ targetUser, user }) => {
    setTarget(user);
    createPeerConnection();
    
    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);

    socket.current.emit('offer', { sdp: offer, target: targetUser, caller: { username: currentUser.username, id: socket.current.id } });
    setIsCalling(true);
  };

  const createAnswer = async ({ payload }) => {
    setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }));
    setAnswer(payload);
    createPeerConnection();
    
    await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));

    // Process any candidates that arrived early
    iceCandidateQueue.current.forEach(candidate => {
      peerConnection.current.addIceCandidate(candidate);
    });
    iceCandidateQueue.current = []; // Clear the queue

    const answerSdp = await peerConnection.current.createAnswer();
    await peerConnection.current.setLocalDescription(answerSdp);
    
    socket.current.emit('answer', { target: payload.caller.id, sdp: answerSdp, caller: currentUser });
    setIncomingcall(false);
    setInCall(true);
  };

  const handleAudio = () => {
    localStream.current.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled;
    });
    setMute(prev => !prev);
  };

  const handleVideo = () => {
    localStream.current.getVideoTracks().forEach(track => {
      track.enabled = !track.enabled;
    });
    setPause(prev => !prev);
  };

  const handleCancelCall = () => {
    setIsCalling(false);
    socket.current.emit('call_canceled', { target, caller: socket.current.id });
    setTarget(null);
  };

  const handleRejectCall = () => {
    setIncomingcall(false);
    socket.current.emit('call_reject', { targetUser: answer.caller.id, callee: socket.current.id });
  };
  
  const handleCallCleanup = () => {
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    setInCall(false);
    setTarget(null);
    setCurrentUser(prev => ({ ...prev, partner: null }));
    remoteVideo.current.srcObject = null;
  };
  
  const handleEnd = () => {
    socket.current.emit('call_ended', { target: currentUser.partner, currentUser: currentUser.id });
    handleCallCleanup();
    setCallEnded(true);
  };

  return (
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
            <button className='muteBtn' onClick={handleAudio}>{mute ? 'Unmute' : 'Mute'}</button>
            <button className='muteBtn' onClick={handleVideo}>{pause ? 'Show Video' : 'Hide Video'}</button>
            {inCall && <button className='muteBtn end-call-btn' onClick={handleEnd}>End Call</button>}
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
                    <button className="call-btn" onClick={() => createOffer({ targetUser: user.id, user: user })}>Call</button>
                  </li>)
                ) : (<li className="no-users">No users online</li>)}
              </ul>
            </div>
          </div>
        </aside>
      </main>
      
      {/* --- Popups --- */}
      {incomingcall && 
        <div className="popup-overlay">
          <div className="popup incoming-call">
            <div className="popup-icon">📞</div>
            <h3>Incoming Call</h3>
            <p>Call from <span className="caller-name">{answer?.caller?.username}</span></p>
            <div className="popup-actions">
              <button className="accept-btn" onClick={() => createAnswer({ payload: answer })}>Accept</button>
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
            <p>Calling <span className="target-name">{target?.username}</span></p>
            <div className="popup-actions">
              <button className="cancel-btn" onClick={handleCancelCall}>Cancel</button>
            </div>
          </div>
        </div>
      }
      
      {userBusy && 
        <div className="popup-overlay">
          <div className="popup user-busy">
            <div className="popup-icon">📵</div>
            <h3>User Busy</h3>
            <p>User is in another call.</p>
            <div className="popup-actions">
              <button className="ok-btn" onClick={() => setUserBusy(false)}>OK</button>
            </div>
          </div>
        </div>
      }
      
      {callReject && 
        <div className="popup-overlay">
          <div className="popup call-rejected">
            <div className="popup-icon">❌</div>
            <h3>Call Declined</h3>
            <p>The user declined your call.</p>
            <div className="popup-actions">
              <button className="ok-btn" onClick={() => { setCallReject(false); setTarget(null); }}>OK</button>
            </div>
          </div>
        </div>
      }
      
      {callEnded && 
        <div className="popup-overlay">
          <div className="popup call-ended">
            <div className="popup-icon">📴</div>
            <h3>Call Ended</h3>
            <div className="popup-actions">
              <button className="ok-btn" onClick={() => setCallEnded(false)}>OK</button>
            </div>
          </div>
        </div>
      }
    </div>
  );
}

export default Home;