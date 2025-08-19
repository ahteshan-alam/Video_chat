import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './home.css'

import { io } from 'socket.io-client'
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
    }
    // For higher reliability, you would add your TURN server credentials here
  ]
};

function Home() {
  let [otherusers, setOtherusers] = useState([])
  let [currentUser, setCurrentUser] = useState({})
  let [incomingcall, setIncomingcall] = useState(false)
  let [isCalling, setIsCalling] = useState(false)
  let [userBusy, setUserBusy] = useState(false)
  let [pendingOffer, setPendingOffer] = useState(null)
  let [mute, setMute] = useState(false)
  let [pause, setPause] = useState(false)
  let [target, setTarget] = useState()
  let [inCall, setInCall] = useState(false)
  let [callReject, setCallReject] = useState(false)
  let [callEnded, setCallEnded] = useState(false)
  const location = useLocation()
  const formData = location.state?.formData
  const localVideo = useRef()
  const localStream = useRef()
  const remoteVideo = useRef()
  const socket = useRef()
  const peerConnection = useRef()
  const candidatesQueue = useRef([])
  const navigate = useNavigate()
  
  useEffect(() => {
    if (!formData) {
      navigate("/")
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localVideo.current.srcObject = stream
        localStream.current = stream
        socket.current = io("https://video-chat-9zhu.onrender.com/");

        // NEW: Error detection for signaling server
        socket.current.on('connect_error', (err) => {
          console.error("Signaling server connection error:", err.message);
          alert("Could not connect to the signaling server. Please check your connection and try again.");
        });

        socket.current.on('connect', () => {
          console.log("Connected to signaling server with ID:", socket.current.id);
          setCurrentUser({ username: formData.username, id: socket.current.id })
          socket.current.emit('new-user', { id: socket.current.id, formData })
        })
        
        socket.current.on('user-joined', ({ message, members }) => {
          setOtherusers(members.filter((client) => client.id !== socket.current.id))
          console.log(message)
        })
        
        socket.current.on('welcome', ({ message, members }) => {
          console.log(message)
          setOtherusers(members.filter((client) => client.id !== socket.current.id))
        })
        
        socket.current.on("user-left", ({ message, members }) => {
          setOtherusers(members.filter(client => client.id !== socket.current.id))
          console.log(message)
        })

        socket.current.on('offer', async (payload) => {
          console.log(`Offer received from ${payload.caller.id}`)
          if (inCall) {
            socket.current.emit('userBusy', {target: payload.caller.id});
            return;
          }
          if (payload.sdp) {
            candidatesQueue.current = []
            peerConnection.current = new RTCPeerConnection(configuration)
            addPeerConnectionEventListeners(peerConnection.current, payload.caller.id);

            // NEW: Error detection for setting session descriptions
            try {
              await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            } catch (error) {
              console.error("Failed to set remote description:", error);
              return;
            }

            await flushCandidatesQueue()
            setPendingOffer(payload)
            setIncomingcall(true)
          }
        })
        
        socket.current.on('userBusy', ({ message }) => {
          setUserBusy(true)
          setIsCalling(false)
          setTarget(null)
          console.log(message)
        })
        
        socket.current.on('answer', async (payload) => {
          setIsCalling(false)
          setInCall(true)

          // NEW: Error detection for setting session descriptions
          try {
            if (peerConnection.current.signalingState !== 'closed') {
              await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            }
          } catch(error) {
            console.error("Failed to set remote description from answer:", error);
            return;
          }
          
          await flushCandidatesQueue()
        })
        
        socket.current.on('call_reject', () => {
          console.log('Call rejected')
          setIsCalling(false)
          setCallReject(true)
        })
        
        socket.current.on('call_cancel', () => {
          setIncomingcall(false)
        })
        
        socket.current.on('call_ended', () => {
          endCallCleanup();
          setCallEnded(true);
        })

        socket.current.on('ice-candidate', async (payload) => {
          if (peerConnection.current && peerConnection.current.remoteDescription) {
            try {
              await peerConnection.current.addIceCandidate(new RTCIceCandidate(payload.route))
            } catch (error) {
              console.error("Error adding received ICE candidate:", error);
            }
          } else {
            candidatesQueue.current.push(payload.route)
            console.log('Queued ICE candidate as remote description not set yet')
          }
        })

        return () => {
          if (socket.current) {
            socket.current.disconnect()
            socket.current.off()
          }
          if (localStream.current) {
            localStream.current.getTracks().forEach(track => track.stop());
          }
          if (peerConnection.current) {
            peerConnection.current.close();
          }
        }
      })
      // NEW: Error detection for camera/microphone permissions
      .catch((error) => {
        console.error("Error accessing media devices.", error);
        alert("Could not access camera and microphone. Please check permissions and try again.");
      });
  }, [formData, inCall, navigate]);

  const addPeerConnectionEventListeners = (pc, targetId) => {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.current.emit('ice-candidate', { target: targetId, route: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideo.current && remoteVideo.current.srcObject !== event.streams[0]) {
        remoteVideo.current.srcObject = event.streams[0];
        console.log('Remote stream received and attached.');
      }
    };

    pc.onicecandidateerror = (e) => console.error('ICE error:', e);

    // NEW: Enhanced detection for failed connections
    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'failed') {
        console.error("Peer connection failed. This could be due to network issues or firewall restrictions.");
        // Optional: Implement a reconnection logic or alert the user
      }
    };

    pc.oniceconnectionstatechange = () => console.log('ICE connection state:', pc.iceConnectionState);
    pc.onsignalingstatechange = () => console.log('Signaling state:', pc.signalingState);
    pc.onicegatheringstatechange = () => console.log('ICE gathering state:', pc.iceGatheringState);
  };
  
  const flushCandidatesQueue = async () => {
    if (peerConnection.current) {
      while (candidatesQueue.current.length > 0) {
        const candidate = candidatesQueue.current.shift();
        try {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
          console.log('Added queued ICE candidate');
        } catch (e) {
          console.error('Error adding queued ICE candidate:', e);
        }
      }
    }
  }
  
  const createOffer = async ({ targetUser, user }) => {
    setTarget(user)
    setIsCalling(true)

    peerConnection.current = new RTCPeerConnection(configuration);
    addPeerConnectionEventListeners(peerConnection.current, targetUser);

    localStream.current.getTracks().forEach(track => {
      peerConnection.current.addTrack(track, localStream.current)
    });

    try {
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      socket.current.emit('offer', { sdp: offer, target: targetUser, caller: { username: currentUser.username, id: socket.current.id } });
      console.log("Sent offer to ", targetUser);
    } catch (error) {
      console.error("Error creating offer:", error);
    }
  }
  
  const createAnswer = async () => {
    if (!peerConnection.current) {
      console.error("Cannot create answer. Peer connection does not exist.");
      return;
    }
    
    localStream.current.getTracks().forEach(track => {
      peerConnection.current.addTrack(track, localStream.current)
    });

    try {
      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);
      await flushCandidatesQueue();
      socket.current.emit('answer', { target: pendingOffer.caller.id, sdp: answer, caller: currentUser });
      setPendingOffer(null);
    } catch (error) {
      console.error("Error creating answer:", error);
    }
  }
  
  const sendAnswer = () => {
    createAnswer();
    setIncomingcall(false);
    setInCall(true);
    console.log("Call accepted");
  }

  const endCallCleanup = () => {
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    setInCall(false);
    setTarget(null);
    setPendingOffer(null);
    candidatesQueue.current = [];
    if (remoteVideo.current) {
      remoteVideo.current.srcObject = null;
    }
  };
  
  const handleAudio = () => setMute(prev => {
    localStream.current.getAudioTracks()[0].enabled = prev;
    return !prev;
  });
  
  const handleVideo = () => setPause(prev => {
    localStream.current.getVideoTracks()[0].enabled = prev;
    return !prev;
  });
  
  const handleCancelCall = () => {
    setIsCalling(false)
    if (target) {
      socket.current.emit('call_canceled', { target: target.id, caller: socket.current.id });
    }
    setTarget(null);
  }
  
  const handleRejectCall = () => {
    setIncomingcall(false);
    if (pendingOffer) {
      socket.current.emit('call_reject', { targetUser: pendingOffer.caller.id, callee: socket.current.id });
    }
    endCallCleanup();
  }
  
  const handleEnd = () => {
    if (currentUser.partner || target) {
      const targetId = currentUser.partner || target.id;
      socket.current.emit('call_ended', { target: targetId });
    }
    endCallCleanup();
    setCallEnded(true);
  }

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
            <button className='muteBtn' onClick={handleVideo}>{pause ? 'Resume Video' : 'Pause Video'}</button>
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
                    <button className="call-btn" disabled={inCall || isCalling} onClick={() => createOffer({ targetUser: user.id, user: user })}>Call</button>
                  </li>)
                ) : (<li className="no-users">No users online</li>)}
              </ul>
            </div>
          </div>
        </aside>
      </main>
    
      {/* Popups */}
      {incomingcall &&
        <div className="popup-overlay">
          <div className="popup incoming-call">
            <div className="popup-icon">📞</div>
            <h3>Incoming Call</h3>
            <p>Call from <span className="caller-name">{pendingOffer?.caller?.username}</span></p>
            <div className="popup-actions">
              <button className="accept-btn" onClick={sendAnswer}>Accept</button>
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
            <p>User is on another call.</p>
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
            <p>{target?.username} declined your call.</p>
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
            <p>Your call has ended.</p>
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