import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './home.css'
import { io } from 'socket.io-client'

const configuration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:global.xirsys.net",
        "turn:global.xirsys.net:3478?transport=udp",
        "turn:global.xirsys.net:3478?transport=tcp",
        "turns:global.xirsys.net:5349?transport=tcp"
      ],
      username: "ahteshan",
      credential: "061c8212-7c6c-11f0-9de2-0242ac140002"
    }
  ]
};

function Home() {
  // [All your state variables remain the same]
  let [otherusers, setOtherusers] = useState([])
  let [currentUser, setCurrentUser] = useState({})
  let [incomingcall, setIncomingcall] = useState(false)
  let [isCalling, setIsCalling] = useState(false)
  let [userBusy, setUserBusy] = useState(false)
  let [answer, setAnswer] = useState()
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
  const navigate = useNavigate()
  
  // Store ICE candidates until peer connection is ready
  const pendingIceCandidates = useRef([]);
  
  useEffect(() => {
    if (!formData) {
      navigate("/")
      return;
    }
    
    const initializeApp = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.current.srcObject = stream;
        localStream.current = stream;
        
        socket.current = io("https://video-chat-9zhu.onrender.com/");
        
        socket.current.on('connect', () => {
          setCurrentUser({ username: formData.username, id: socket.current.id });
          socket.current.emit('new-user', { id: socket.current.id, formData });
        });
        
        socket.current.on('user-joined', ({ message, members }) => {
          setOtherusers(members.filter((client) => client.id !== socket.current.id));
          console.log(message);
        });
        
        socket.current.on('welcome', ({ message, members }) => {
          console.log(message);
          setOtherusers(members.filter((client) => client.id !== socket.current.id));
        });
        
        socket.current.on("user-left", ({ message, members }) => {
          setOtherusers(members.filter(client => client.id !== socket.current.id));
          console.log(message);
        });

        socket.current.on('offer', async (payload) => {
          console.log(`offer received from ${payload.caller.id} to ${payload.target}`);
          if (payload.sdp) {
            setIncomingcall(true);
            setAnswer(payload);
          }
        });
        
        socket.current.on('userBusy', ({ message }) => {
          setUserBusy(true);
          setIsCalling(false);
          setTarget(null);
          console.log(message);
        });
        
        socket.current.on('answer', async (payload) => {
          console.log("Answer received:", payload);
          setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }));
          setIsCalling(false);
          setInCall(true);
          
          try {
            // Set remote description first
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            
            // Add any pending ICE candidates
            while (pendingIceCandidates.current.length > 0) {
              const candidate = pendingIceCandidates.current.shift();
              await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
            }
          } catch (error) {
            console.error("Error setting remote description:", error);
          }
        });
        
        socket.current.on('call_reject', () => {
          console.log('call rejected');
          setIsCalling(false);
          setCallReject(true);
        });
        
        socket.current.on('call_cancel', () => {
          setIncomingcall(false);
        });
        
        socket.current.on('call_ended', () => {
          setCallEnded(true);
          if (localStream.current) {
            localStream.current.getTracks().forEach(track => track.stop());
          }
          
          if (peerConnection.current) {
            peerConnection.current.close();
          }
          
          localStream.current = null;
          setTarget(null);
          setInCall(false);
          peerConnection.current = null;
        });

        socket.current.on('ice-candidate', async (payload) => {
          if (peerConnection.current && peerConnection.current.remoteDescription) {
            try {
              await peerConnection.current.addIceCandidate(new RTCIceCandidate(payload.route));
            } catch (error) {
              console.error("Error adding received ice candidate:", error);
            }
          } else {
            // Store ICE candidates until remote description is set
            pendingIceCandidates.current.push(payload.route);
          }
        });

        return () => {
          if (socket.current) {
            socket.current.disconnect();
            socket.current.off();
          }
        };
      } catch (error) {
        console.error("Error initializing app:", error);
      }
    };
    
    initializeApp();
  }, [formData, navigate]);

  const createOffer = async ({ targetUser, user }) => {
    setTarget(user);
    console.log("sending offer to ", targetUser);
    setIsCalling(true);
    
    try {
      if (!localStream.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStream.current = stream;
        localVideo.current.srcObject = stream;
      }
      
      // Reset pending ICE candidates
      pendingIceCandidates.current = [];
      
      // Create new peer connection
      peerConnection.current = new RTCPeerConnection(configuration);
      
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          socket.current.emit('ice-candidate', { target: targetUser, route: event.candidate });
        }
      };
      
      peerConnection.current.ontrack = (event) => {
        console.log("Received remote stream");
        remoteVideo.current.srcObject = event.streams[0];
      };
      
      peerConnection.current.onconnectionstatechange = (event) => {
        console.log("Connection state:", peerConnection.current.connectionState);
      };
      
      // Add local tracks
      localStream.current.getTracks().forEach(track => {
        peerConnection.current.addTrack(track, localStream.current);
      });
      
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      
      socket.current.emit('offer', { 
        sdp: offer, 
        target: targetUser, 
        caller: { username: currentUser.username, id: socket.current.id } 
      });
      
      console.log("Sent offer to ", targetUser);
    } catch (error) {
      console.error("Error creating offer:", error);
      setIsCalling(false);
    }
  };
  
  const createAnswer = async ({ payload }) => {
    try {
      setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }));
      
      if (!localStream.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStream.current = stream;
        localVideo.current.srcObject = stream;
      }
      
      // Reset pending ICE candidates
      pendingIceCandidates.current = [];
      
      peerConnection.current = new RTCPeerConnection(configuration);
      
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          socket.current.emit('ice-candidate', { target: payload.caller.id, route: event.candidate });
        }
      };
      
      peerConnection.current.ontrack = (event) => {
        console.log("Received remote stream in answer");
        remoteVideo.current.srcObject = event.streams[0];
      };
      
      peerConnection.current.onconnectionstatechange = (event) => {
        console.log("Connection state:", peerConnection.current.connectionState);
      };
      
      // Add local tracks
      localStream.current.getTracks().forEach(track => {
        peerConnection.current.addTrack(track, localStream.current);
      });
      
      // Set remote description first
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      
      // Add any pending ICE candidates
      while (pendingIceCandidates.current.length > 0) {
        const candidate = pendingIceCandidates.current.shift();
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
      
      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);
      
      socket.current.emit('answer', { 
        target: payload.caller.id, 
        sdp: answer, 
        caller: currentUser 
      });
    } catch (error) {
      console.error("Error creating answer:", error);
    }
  };
  
  const sendAnswer = (answer) => {
    createAnswer({ payload: answer });
    setIncomingcall(false);
    setInCall(true);
    console.log("Call accepted");
    setCurrentUser(prev => ({ ...prev, partner: answer.caller.id }));
  };
  const handleAudio = () => {
    mute ? (localStream.current.getAudioTracks().forEach(audioTrack => audioTrack.enabled = true), setMute(false)) : (localStream.current.getAudioTracks().forEach(audioTrack => audioTrack.enabled = false), setMute(true))


  }
  const handleVideo = () => {
    pause ? (localStream.current.getVideoTracks().forEach(videoTrack => videoTrack.enabled = true), setPause(false)) : (localStream.current.getVideoTracks().forEach(videoTrack => videoTrack.enabled = false), setPause(true))
  }
  const handleCancelCall = () => {
    setIsCalling(false)
    socket.current.emit('call_canceled', { target, caller: socket.current.id })
    setTarget(null)
  }
  const handleRejectCall = () => {
    setIncomingcall(false)

    socket.current.emit('call_reject', ({ targetUser: answer.caller.id, callee: socket.current.id }))
  }
  const handleEnd = () => {
    setTarget(null)
    socket.current.emit('call_ended', { target: currentUser.partner, currentUser: currentUser.id })
    console.log("you are ending the call")
    if (localStream) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }


    if (peerConnection) {
      peerConnection.current.close();
      peerConnection.current = null;
    }



    setCallEnded(true)
    setInCall(false);



  }



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