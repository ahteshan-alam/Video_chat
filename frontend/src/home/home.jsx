import 'webrtc-adapter'; // For browser compatibility
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './home.css';
import { io } from 'socket.io-client';

// Enhanced configuration with more STUN servers and better timeout handling
const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.stunprotocol.org:3478" },
    {
      urls: [
        "turn:global.xirsys.net:3478?transport=udp",
        "turn:global.xirsys.net:3478?transport=tcp",
        "turns:global.xirsys.net:5349?transport=tcp"
      ],
      username: "ahteshan",
      credential: "061c8212-7c6c-11f0-9de2-0242ac140002"
    }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'balanced',
  rtcpMuxPolicy: 'require'
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
  const [connectionState, setConnectionState] = useState('new');

  const location = useLocation();
  const formData = location.state?.formData;
  const localVideo = useRef();
  const localStream = useRef();
  const remoteVideo = useRef();
  const socket = useRef();
  const peerConnection = useRef();
  const iceCandidateQueue = useRef([]);
  const pendingOffer = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!formData) {
      navigate("/");
      return;
    }

    // Enhanced media constraints for better compatibility
    const mediaConstraints = {
      video: {
        width: { min: 320, ideal: 640, max: 1280 },
        height: { min: 240, ideal: 480, max: 720 },
        frameRate: { ideal: 15, max: 30 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 44100
      }
    };

    navigator.mediaDevices.getUserMedia(mediaConstraints)
      .then((stream) => {
        if (localVideo.current) {
          localVideo.current.srcObject = stream;
        }
        localStream.current = stream;
        
        socket.current = io("https://video-chat-9zhu.onrender.com/", {
          transports: ['websocket', 'polling'],
          timeout: 20000,
          forceNew: true
        });

        // Socket Event Handlers
        socket.current.on('connect', () => {
          console.log('Socket connected:', socket.current.id);
          setCurrentUser({ username: formData.username, id: socket.current.id });
          socket.current.emit('new-user', { id: socket.current.id, formData });
        });

        socket.current.on('user-joined', ({ members }) => {
          console.log('User joined, members:', members);
          setOtherusers(members.filter((client) => client.id !== socket.current.id));
        });

        socket.current.on('welcome', ({ members }) => {
          console.log('Welcome received, members:', members);
          setOtherusers(members.filter((client) => client.id !== socket.current.id));
        });

        socket.current.on("user-left", ({ members }) => {
          console.log('User left, members:', members);
          setOtherusers(members.filter(client => client.id !== socket.current.id));
        });

        socket.current.on('offer', async (payload) => {
          console.log('Received offer:', payload);
          if (payload.sdp && !inCall && !incomingcall) {
            setIncomingcall(true);
            setAnswer(payload);
            pendingOffer.current = payload;
          }
        });

        socket.current.on('userBusy', () => {
          console.log('User is busy');
          setUserBusy(true);
          setIsCalling(false);
          setTarget(null);
          cleanupPeerConnection();
        });

        socket.current.on('answer', async (payload) => {
          console.log('Received answer:', payload);
          try {
            if (peerConnection.current && payload.sdp) {
              if (peerConnection.current.signalingState === 'have-local-offer') {
                await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                console.log('Remote description set successfully');
                
                // Process queued ICE candidates
                while (iceCandidateQueue.current.length > 0) {
                  const candidate = iceCandidateQueue.current.shift();
                  try {
                    await peerConnection.current.addIceCandidate(candidate);
                    console.log('Added queued ICE candidate');
                  } catch (e) {
                    console.error('Error adding queued ICE candidate:', e);
                  }
                }

                setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }));
                setIsCalling(false);
                setInCall(true);
              }
            }
          } catch (error) {
            console.error('Error handling answer:', error);
            handleCallCleanup();
          }
        });

        socket.current.on('ice-candidate', async (payload) => {
          console.log('Received ICE candidate:', payload);
          try {
            const candidate = new RTCIceCandidate(payload.route);
            
            if (peerConnection.current) {
              if (peerConnection.current.remoteDescription && 
                  peerConnection.current.remoteDescription.type) {
                await peerConnection.current.addIceCandidate(candidate);
                console.log('ICE candidate added successfully');
              } else {
                iceCandidateQueue.current.push(candidate);
                console.log('ICE candidate queued');
              }
            }
          } catch (error) {
            console.error('Error handling ICE candidate:', error);
          }
        });

        socket.current.on('call_reject', () => {
          console.log('Call rejected');
          setIsCalling(false);
          setCallReject(true);
          cleanupPeerConnection();
        });

        socket.current.on('call_cancel', () => {
          console.log('Call cancelled');
          setIncomingcall(false);
          pendingOffer.current = null;
        });

        socket.current.on('call_ended', () => {
          console.log('Call ended by remote');
          handleCallCleanup();
          setCallEnded(true);
        });

        socket.current.on('disconnect', () => {
          console.log('Socket disconnected');
          handleCallCleanup();
        });

        socket.current.on('connect_error', (error) => {
          console.error('Socket connection error:', error);
        });
      })
      .catch((error) => {
        console.error('Error accessing media devices:', error);
        alert('Could not access camera/microphone. Please check permissions.');
      });
      
    return () => {
      console.log('Component unmounting, cleaning up...');
      handleCallCleanup();
      if (socket.current) {
        socket.current.disconnect();
      }
      if (localStream.current) {
        localStream.current.getTracks().forEach(track => {
          track.stop();
          console.log('Stopped track:', track.kind);
        });
      }
    };
  }, [formData, navigate]);

  const cleanupPeerConnection = () => {
    if (peerConnection.current) {
      peerConnection.current.onicecandidate = null;
      peerConnection.current.ontrack = null;
      peerConnection.current.onconnectionstatechange = null;
      peerConnection.current.oniceconnectionstatechange = null;
      peerConnection.current.onsignalingstatechange = null;
      peerConnection.current.close();
      peerConnection.current = null;
    }
    iceCandidateQueue.current = [];
    setConnectionState('new');
  };

  const createPeerConnection = () => {
    console.log('Creating peer connection...');
    
    if (peerConnection.current) {
      cleanupPeerConnection();
    }

    try {
      peerConnection.current = new RTCPeerConnection(configuration);
      iceCandidateQueue.current = [];

      // Enhanced event handlers
      peerConnection.current.onicecandidate = (event) => {
        console.log('ICE candidate event:', event.candidate ? 'candidate' : 'end-of-candidates');
        if (event.candidate) {
          const targetId = target?.id || answer?.caller?.id;
          if (targetId) {
            socket.current.emit('ice-candidate', { 
              target: targetId, 
              route: event.candidate 
            });
          }
        }
      };

      peerConnection.current.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        const [remoteStream] = event.streams;
        if (remoteVideo.current && remoteStream) {
          remoteVideo.current.srcObject = remoteStream;
          console.log('Set remote video stream');
          
          // Ensure video plays on mobile
          setTimeout(() => {
            if (remoteVideo.current) {
              remoteVideo.current.play().catch(e => console.log('Remote video autoplay failed:', e));
            }
          }, 100);
        }
      };

      // Connection state monitoring
      peerConnection.current.onconnectionstatechange = () => {
        const state = peerConnection.current?.connectionState;
        console.log('Connection state changed:', state);
        setConnectionState(state);
        
        if (state === 'failed' || state === 'disconnected') {
          console.log('Connection failed, attempting restart...');
          setTimeout(() => {
            if (peerConnection.current?.connectionState === 'failed') {
              handleCallCleanup();
            }
          }, 5000);
        }
      };

      peerConnection.current.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.current?.iceConnectionState);
      };

      peerConnection.current.onsignalingstatechange = () => {
        console.log('Signaling state:', peerConnection.current?.signalingState);
      };

      // Add local tracks
      if (localStream.current) {
        localStream.current.getTracks().forEach(track => {
          console.log('Adding local track:', track.kind);
          peerConnection.current.addTrack(track, localStream.current);
        });
      }

      return true;
    } catch (error) {
      console.error('Error creating peer connection:', error);
      return false;
    }
  };

  const createOffer = async ({ targetUser, user }) => {
    console.log('Creating offer for user:', user.username);
    
    if (inCall || isCalling) {
      console.log('Already in call or calling');
      return;
    }

    setTarget(user);
    setIsCalling(true);

    if (!createPeerConnection()) {
      setIsCalling(false);
      return;
    }
    
    try {
      // Create offer with enhanced options
      const offer = await peerConnection.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: false
      });

      await peerConnection.current.setLocalDescription(offer);
      console.log('Local description set, sending offer');

      socket.current.emit('offer', { 
        sdp: offer, 
        target: targetUser, 
        caller: { 
          username: currentUser.username, 
          id: socket.current.id 
        } 
      });

      // Set timeout for call
      setTimeout(() => {
        if (isCalling && !inCall) {
          console.log('Call timeout');
          handleCancelCall();
        }
      }, 30000);

    } catch (error) {
      console.error('Error creating offer:', error);
      setIsCalling(false);
      cleanupPeerConnection();
    }
  };

  const createAnswer = async ({ payload }) => {
    console.log('Creating answer for offer from:', payload.caller.username);
    
    if (inCall) {
      console.log('Already in call');
      return;
    }

    if (!createPeerConnection()) {
      console.error('Failed to create peer connection for answer');
      return;
    }

    try {
      setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }));
      setAnswer(payload);
      
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      console.log('Remote description set for answer');
      
      // Process any queued ICE candidates
      while (iceCandidateQueue.current.length > 0) {
        const candidate = iceCandidateQueue.current.shift();
        try {
          await peerConnection.current.addIceCandidate(candidate);
          console.log('Added queued ICE candidate during answer');
        } catch (e) {
          console.error('Error adding queued ICE candidate during answer:', e);
        }
      }

      const answerSdp = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answerSdp);
      console.log('Answer created and set as local description');
      
      socket.current.emit('answer', { 
        target: payload.caller.id, 
        sdp: answerSdp, 
        caller: currentUser 
      });
      
      setIncomingcall(false);
      setInCall(true);
      pendingOffer.current = null;

    } catch (error) {
      console.error('Error creating answer:', error);
      setIncomingcall(false);
      cleanupPeerConnection();
    }
  };

  const handleCallCleanup = () => {
    console.log('Cleaning up call...');
    cleanupPeerConnection();
    setInCall(false);
    setTarget(null);
    setCurrentUser(prev => ({ ...prev, partner: null }));
    if (remoteVideo.current) {
      remoteVideo.current.srcObject = null;
    }
  };

  const handleEnd = () => {
    console.log('Ending call...');
    if (currentUser.partner) {
      socket.current.emit('call_ended', { 
        target: currentUser.partner, 
        currentUser: currentUser.id 
      });
    }
    handleCallCleanup();
    setCallEnded(true);
  };

  const handleAudio = () => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
        console.log('Audio track enabled:', track.enabled);
      });
      setMute(prev => !prev);
    }
  };

  const handleVideo = () => {
    if (localStream.current) {
      localStream.current.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
        console.log('Video track enabled:', track.enabled);
      });
      setPause(prev => !prev);
    }
  };

  const handleCancelCall = () => {
    console.log('Cancelling call...');
    setIsCalling(false);
    if (target) {
      socket.current.emit('call_canceled', { 
        target, 
        caller: socket.current.id 
      });
    }
    setTarget(null);
    cleanupPeerConnection();
  };

  const handleRejectCall = () => {
    console.log('Rejecting call...');
    setIncomingcall(false);
    if (answer) {
      socket.current.emit('call_reject', { 
        targetUser: answer.caller.id, 
        callee: socket.current.id 
      });
    }
    pendingOffer.current = null;
    cleanupPeerConnection();
  };

  return (
    <div className='App'>
      <header className="app-header">
        <h1>My Video Call App {currentUser.username}</h1>
        {connectionState !== 'new' && (
          <div className="connection-status">
            Connection: {connectionState}
          </div>
        )}
      </header>
      <main className="main-content">
        <section className="video-section">
          <div className='video'>
            <div className="local-video-container">
              <video 
                ref={localVideo} 
                autoPlay 
                muted 
                playsInline
                style={{ transform: 'scaleX(-1)' }} // Mirror local video
              ></video>
              <div className="video-label">You</div>
            </div>
            <div className="remote-video-container">
              <video 
                ref={remoteVideo} 
                autoPlay 
                playsInline 
                controls={false}
              ></video>
              <div className="video-label">Remote</div>
            </div>
          </div>
          <div className="video-controls">
            <button className='muteBtn' onClick={handleAudio} disabled={!localStream.current}>
              {mute ? 'Unmute' : 'Mute'}
            </button>
            <button className='muteBtn' onClick={handleVideo} disabled={!localStream.current}>
              {pause ? 'Show Video' : 'Hide Video'}
            </button>
            {inCall && (
              <button className='muteBtn end-call-btn' onClick={handleEnd}>
                End Call
              </button>
            )}
          </div>
        </section>
        <aside className="sidebar">
          <div className='list'>
            <div className="list-header">
              <p>Online Users ({otherusers.length})</p>
            </div>
            <div className="list-content">
              <ul>
                {otherusers.length > 0 ? otherusers.map(user => (
                  <li key={user.id} className="user-item">
                    <span className="user-info">
                      <span className="online-indicator"></span>
                      <span className="username">{user.username}</span>
                    </span>
                    <button 
                      className="call-btn" 
                      onClick={() => createOffer({ targetUser: user.id, user: user })}
                      disabled={inCall || isCalling}
                    >
                      {user.busy ? 'Busy' : 'Call'}
                    </button>
                  </li>
                )) : (
                  <li className="no-users">No users online</li>
                )}
              </ul>
            </div>
          </div>
        </aside>
      </main>
      
      {/* Modals remain the same */}
      {incomingcall && (
        <div className="popup-overlay">
          <div className="popup incoming-call">
            <div className="popup-icon">📞</div>
            <h3>Incoming Call</h3>
            <p>Call from <span className="caller-name">{answer?.caller?.username}</span></p>
            <div className="popup-actions">
              <button className="accept-btn" onClick={() => createAnswer({ payload: answer })}>
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
            <p>Calling <span className="target-name">{target?.username}</span></p>
            <div className="popup-actions">
              <button className="cancel-btn" onClick={handleCancelCall}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      
      {userBusy && (
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
      )}
      
      {callReject && (
        <div className="popup-overlay">
          <div className="popup call-rejected">
            <div className="popup-icon">❌</div>
            <h3>Call Declined</h3>
            <p>The user declined your call.</p>
            <div className="popup-actions">
              <button className="ok-btn" onClick={() => { setCallReject(false); setTarget(null); }}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      
      {callEnded && (
        <div className="popup-overlay">
          <div className="popup call-ended">
            <div className="popup-icon">📴</div>
            <h3>Call Ended</h3>
            <div className="popup-actions">
              <button className="ok-btn" onClick={() => setCallEnded(false)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Home;