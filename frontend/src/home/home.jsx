import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './home.css';
import { io } from 'socket.io-client';
// NOTE: I've removed the external libraries like ScrollToBottom and Message 
// for this snippet, assuming they are imported correctly in your actual project.
// You'll need to add those imports back.

const configuration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:global.xirsys.net",
      ],
      // Note: TURN server credentials are often temporary or require a backend service to fetch.
      // These credentials might be expired or invalid.
      username: "ahteshan",
      credential: "061c8212-7c6c-11f0-9de2-0242ac140002"
    }
  ]
};

function Home() {
  const location = useLocation();
  const formData = location.state?.formData;
  const username = formData?.username;
  const room = formData?.room;

  const [otherusers, setOtherusers] = useState([]);
  const [currentUser, setCurrentUser] = useState({});
  const [incomingcall, setIncomingcall] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [userBusy, setUserBusy] = useState(false);
  const [answer, setAnswer] = useState();
  const [mute, setMute] = useState(false);
  const [pause, setPause] = useState(false);
  const [target, setTarget] = useState();
  const [inCall, setInCall] = useState(false);
  const [callDeclined, setCallDeclined] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [videoCall, setVideoCall] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [showOnlineUsers, setShowOnlineUsers] = useState(false);
  const [currUserId, setCurrUserId] = useState("");
  const [typeMsg, setTypeMsg] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const candidatesQueue = useRef([]);
  const socket = useRef(null);
  const typingTimeout = useRef(null);
  const localVideo = useRef();
  const localStream = useRef();
  const remoteVideo = useRef();
  const peerConnection = useRef();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setMessage(e.target.value);
    if (!isTyping) {
      setIsTyping(true);
      socket.current.emit("typing", { username, room });
    }
    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current);
    }
    typingTimeout.current = setTimeout(() => {
      setIsTyping(false);
      socket.current.emit("typing", { username: "", room });
    }, 1000);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsTyping(false);
    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current);
    }
    socket.current.emit("typing", { username: "", room });
    socket.current.emit("message", { message, username });
    setMessage("");
  };

  const toggleOnlineUsers = () => {
    setShowOnlineUsers((prev) => !prev);
  };

  // --- MODIFIED useEffect ---
  useEffect(() => {
    if (!formData) {
      navigate("/");
      return;
    }

    // Connect to the socket server
    socket.current = io("https://video-chat-9zhu.onrender.com/");

    // Setup all socket event listeners
    socket.current.on('connect', () => {
      setCurrUserId(socket.current.id);
      setCurrentUser({ username: formData.username, id: socket.current.id });
      socket.current.emit('join-room', { id: socket.current.id, formData });
    });

    socket.current.on('welcome', ({ message, members, id, type }) => {
      setOtherusers(members.filter((client) => client.id !== socket.current.id));
      setMessages((prev) => [...prev, { message, type, id }]);
      setIsLoading(false);
    });

    socket.current.on('user-joined', ({ message, members, id, type }) => {
      setOtherusers(members.filter((client) => client.id !== socket.current.id));
      setMessages((prev) => [...prev, { message, type, id }]);
    });

    socket.current.on("send-message", ({ message, username, type, id, time, userId }) => {
      setMessages((prev) => [...prev, { message, username, type, id, time, userId }]);
    });

    socket.current.on("user-left", ({ message, members, id, type }) => {
      setOtherusers(members.filter(client => client.id !== socket.current.id));
      setMessages((prev) => [...prev, { message, type, id }]);
    });

    socket.current.on("user-typing", ({ message }) => {
      setTypeMsg(message);
    });

    socket.current.on('offer', async (payload) => {
      if (peerConnection.current || inCall) {
        socket.current.emit("userBusy", { target: payload.caller.id });
        return;
      }
      setVideoCall(true); // Show video UI for incoming call
      peerConnection.current = new RTCPeerConnection(configuration);
      
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          socket.current.emit('ice-candidate', { target: payload.caller.id, route: event.candidate });
        }
      };
      
      peerConnection.current.ontrack = (event) => {
        const stream = event.streams[0];
        // ✅ Safety check for remote video
        if (remoteVideo.current && remoteVideo.current.srcObject !== stream) {
          remoteVideo.current.srcObject = stream;
        }
      };

      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      
      // Process any queued candidates
      while (candidatesQueue.current.length) {
        const candidate = candidatesQueue.current.shift();
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
      
      if (payload.sdp) {
        setIncomingcall(true);
      }
      setAnswer(payload);
    });
    
    // ... (Keep all your other socket listeners: 'userBusy', 'answer', 'call_declined', etc.)
    socket.current.on('userBusy', () => {
        setUserBusy(true);
        setIsCalling(false);
        setTarget(null);
    });

    socket.current.on('answer', async (payload) => {
        setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }));
        setIsCalling(false);
        setInCall(true);
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        // Process any queued candidates
        while (candidatesQueue.current.length) {
            const candidate = candidatesQueue.current.shift();
            await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
    });

    socket.current.on('call_declined', () => {
        resetCall();
        setCallDeclined(true);
    });
    
    socket.current.on('call_cancel', () => {
        resetCall();
    });

    socket.current.on('call_ended', () => {
        setCallEnded(true);
        resetCall();
    });

    socket.current.on('ice-candidate', async (payload) => {
        const candidate = new RTCIceCandidate(payload.route);
        if (peerConnection.current && peerConnection.current.remoteDescription) {
            await peerConnection.current.addIceCandidate(candidate);
        } else {
            // Queue candidate if remote description is not set yet
            candidatesQueue.current.push(payload.route);
        }
    });


    // Cleanup function
    return () => {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      // Call cleanup is handled by resetCall on component unmount if needed
      if (socket.current) {
        socket.current.disconnect();
        socket.current.off();
      }
    };
  }, [formData, navigate]);

  if (isLoading) {
    return (
      <div className="chatbox">
        <div className="header"><h1>ChatterBox</h1></div>
        <div className="loading-area">
          <h2 className="loading-text">Connecting to ChatterBox...</h2>
          <div className="loader"></div>
        </div>
      </div>
    );
  }

  // --- MODIFIED createOffer ---
  const createOffer = async ({ targetUser, user }) => {
    setVideoCall(true);
    setTarget(user);
    setIsCalling(true);

    try {
      // Get media stream ONLY when starting a call
      if (!localStream.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStream.current = stream;
        // ✅ Safety check before setting srcObject
        if (localVideo.current) {
          localVideo.current.srcObject = stream;
        }
      }

      peerConnection.current = new RTCPeerConnection(configuration);
      
      localStream.current.getTracks().forEach(track => {
        peerConnection.current.addTrack(track, localStream.current);
      });

      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          socket.current.emit('ice-candidate', { target: targetUser, route: event.candidate });
        }
      };

      peerConnection.current.ontrack = (event) => {
        const stream = event.streams[0];
        // ✅ Safety check for remote video
        if (remoteVideo.current && remoteVideo.current.srcObject !== stream) {
          remoteVideo.current.srcObject = stream;
        }
      };

      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);

      socket.current.emit('offer', { sdp: offer, target: targetUser, caller: { username: currentUser.username, id: socket.current.id } });
    } catch (error) {
      console.error("Error creating offer or getting media:", error);
      alert("Could not start call. Please check camera/microphone permissions.");
      resetCall();
    }
  };

  // --- MODIFIED createAnswer ---
  const createAnswer = async ({ payload }) => {
    setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }));
    try {
      // Get media stream ONLY when answering a call
      if (!localStream.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStream.current = stream;
        // ✅ Safety check before setting srcObject
        if (localVideo.current) {
          localVideo.current.srcObject = stream;
        }
      }

      localStream.current.getTracks().forEach(track => {
        peerConnection.current.addTrack(track, localStream.current);
      });

      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);

      socket.current.emit('answer', { target: payload.caller.id, sdp: answer, caller: currentUser });
    } catch (error) {
      console.error("Error creating answer or getting media:", error);
      alert("Could not answer call. Please check camera/microphone permissions.");
      resetCall();
    }
  };

  const sendAnswer = (payload) => {
    createAnswer({ payload });
    setIncomingcall(false);
    setInCall(true);
  };
  
  const resetCall = () => {
    if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
    }
    if (localStream.current) {
        localStream.current.getTracks().forEach(track => track.stop());
        localStream.current = null;
    }
    if (localVideo.current) {
        localVideo.current.srcObject = null;
    }
    if (remoteVideo.current) {
        remoteVideo.current.srcObject = null;
    }

    candidatesQueue.current = [];
    setInCall(false);
    setIncomingcall(false);
    setIsCalling(false);
    setAnswer(null);
    setTarget(null);
    // You may want to conditionally set videoCall to false
    // setVideoCall(false); 
  };
  
  const handleAudio = () => {
    if (localStream.current) {
        localStream.current.getAudioTracks().forEach(track => {
            track.enabled = !track.enabled;
        });
        setMute(prev => !prev);
    }
  };

  const handleVideo = () => {
    if (localStream.current) {
        localStream.current.getVideoTracks().forEach(track => {
            track.enabled = !track.enabled;
        });
        setPause(prev => !prev);
    }
  };

  const handleCancelCall = () => {
    socket.current.emit('call_canceled', { target: target.id });
    resetCall();
    setVideoCall(false);
  };

  const handleRejectCall = () => {
    socket.current.emit('call_reject', { targetUser: answer.caller.id });
    resetCall();
    setVideoCall(false);
  };

  const handleEnd = () => {
    socket.current.emit('call_ended', { target: currentUser.partner });
    resetCall();
    setVideoCall(false);
  };

  return (
    <div className="chatbox">
      <div className="header">
        <h1>ChatterBox</h1>
        <div className="online-section">
          <button className="online-count-btn" onClick={toggleOnlineUsers}>
            <span className="online-indicator">●</span>
            <span>{otherusers.length} online</span>
          </button>

          {showOnlineUsers && (
            <div className="online-dropdown">
              <div className="dropdown-header">
                Online Users ({otherusers.length})
              </div>
              <div className="online-users-list">
                {otherusers.map((client) => (
                  <div key={client.id} className="online-user-item">
                    <span className="user-online-indicator">●</span>
                    <span className="username">{client.username}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="messages-container">
        <ScrollToBottom className="messages">
          {messages.map((item) =>
            item.type === "notification" ? (
              <h2 key={item.id} className="notification">
                {item.message}
              </h2>
            ) : (
              <Message key={item.id} data={item} currUserId={currUserId} />
            )
          )}
        </ScrollToBottom>

        {typeMsg && (
          <div className="typing-indicator">
            {typeMsg}
          </div>
        )}
      </div>

      <div className="footer">
        <form className="messageForm" onSubmit={handleSubmit}>
          <input
            type="text"
            className="message"
            value={message}
            onChange={handleChange}
            required
            placeholder="Type a message..."
          />
          <button type="submit">send</button>
        </form>
      </div>


      {videoCall && <div className='App'>
        <header className="app-header">
          <h1>My Video Call App {currentUser.username}</h1>
        </header>

        <main className="main-content">
          <section className="video-section">
            <div className='video'>
              <div className="local-video-container">
                <video ref={localVideo} autoPlay playsInline></video>
                <div className="video-label">You</div>
              </div>

              <div className="remote-video-container">
                <video ref={remoteVideo} autoPlay playsInline></video>
                <div className="video-label">Remote</div>
              </div>
            </div>

            <div className="video-controls">
              <button className='muteBtn' onClick={handleAudio}>
                {mute ? "🔇 Unmute" : "🎤 Mute"}
              </button>
              <button className='muteBtn' onClick={handleVideo}>
                {pause ? "📹 Resume" : "📹 Pause"}
              </button>

              {inCall && <button className='muteBtn end-call-btn' onClick={handleEnd}>❌ End</button>}
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
                <button className="ok-btn" onClick={() => { setUserBusy(false), setVideoCall(false) }}>ok</button>
              </div>
            </div>
          </div>
        }

        {callDeclined &&
          <div className="popup-overlay">
            <div className="popup call-rejected">
              <div className="popup-icon">❌</div>
              <h3>Call Declined</h3>
              <p>{target?.username || 'The user'} declined your call</p>
              <div className="popup-actions">
                <button className="ok-btn" onClick={() => { setCallDeclined(false), setTarget(null), setVideoCall(false) }}>ok</button>

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
                <button className="ok-btn" onClick={() => { setCallEnded(false), setVideoCall(false) }}>ok</button>
              </div>
            </div>
          </div>
        }
      </div>
      }</div>
  );
}

export default Home;