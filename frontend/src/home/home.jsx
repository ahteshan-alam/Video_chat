import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './home.css';
import { io } from 'socket.io-client';
import ScrollToBottom from 'react-scroll-to-bottom';
import Message from '../message/message';

const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:global.xirsys.net',
        'turn:global.xirsys.net:3478?transport=udp',
        'turn:global.xirsys.net:3478?transport=tcp',
        'turns:global.xirsys.net:5349?transport=tcp',
      ],
      username: 'ahteshan',
      credential: '061c8212-7c6c-11f0-9de2-0242ac140002',
    },
  ],
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
  const [answer, setAnswer] = useState(null);
  const [mute, setMute] = useState(true);
  const [pause, setPause] = useState(true);
  const [target, setTarget] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [callDeclined, setCallDeclined] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [videoCall, setVideoCall] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [showOnlineUsers, setShowOnlineUsers] = useState(false);
  const [currUserId, setCurrUserId] = useState('');
  const [typeMsg, setTypeMsg] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const candidatesQueue = useRef([]);
  const socket = useRef(null);
  const typingTimeout = useRef(null);
  const localVideo = useRef(null);
  const localStream = useRef(null);
  const remoteVideo = useRef(null);
  const peerConnection = useRef(null);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setMessage(e.target.value);

    if (!isTyping) {
      setIsTyping(true);
      socket.current.emit('typing', { username, room });
    }

    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current);
    }

    typingTimeout.current = setTimeout(() => {
      setIsTyping(false);
      socket.current.emit('typing', { username: '', room });
    }, 1000);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsTyping(false);

    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current);
    }

    socket.current.emit('typing', { username: '', room });
    socket.current.emit('message', { message, username });
    setMessage('');
  };

  const toggleOnlineUsers = () => {
    setShowOnlineUsers((prev) => !prev);
  };

  useEffect(() => {
    if (!formData) {
      navigate('/');
      return;
    }

    socket.current = io('https://video-chat-9zhu.onrender.com/');
    socket.current.on('connect', () => {
      setCurrUserId(socket.current.id);
      setCurrentUser({ username: formData.username, id: socket.current.id });
      socket.current.emit('join-room', { id: socket.current.id, formData });
    });

    socket.current.on('user-joined', ({ message, members, id, type }) => {
      setOtherusers(members.filter((client) => client.id !== socket.current.id));
      setMessages((prev) => [...prev, { message, type, id }]);
    });

    socket.current.on('welcome', ({ message, members, id, type }) => {
      setOtherusers(members.filter((client) => client.id !== socket.current.id));
      setMessages((prev) => [...prev, { message, type, id }]);
      setIsLoading(false);
    });

    socket.current.on('send-message', ({ message, username, type, id, time, userId }) => {
      setMessages((prev) => [...prev, { message, username, type, id, time, userId }]);
    });

    socket.current.on('user-left', ({ message, members, id, type }) => {
      setOtherusers(members.filter((client) => client.id !== socket.current.id));
      setMessages((prev) => [...prev, { message, type, id }]);
    });

    socket.current.on('user-typing', ({ message }) => {
      setTypeMsg(message);
    });

    socket.current.on('offer', async (payload) => {
      console.log(`offer received from ${payload.caller.id} to ${payload.target}`);
      if (peerConnection.current || inCall) {
        socket.current.emit('userBusy', { target: payload.caller.id });
        return;
      }
      setVideoCall(true)
      peerConnection.current = new RTCPeerConnection(configuration);
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          socket.current.emit('ice-candidate', { target: payload.caller.id, route: event.candidate });
        }
      };
      peerConnection.current.ontrack = (event) => {
        const stream = event.streams[0];
        if (remoteVideo.current && remoteVideo.current.srcObject !== stream) {
          remoteVideo.current.srcObject = stream;
          const playPromise = remoteVideo.current.play();
          if (playPromise !== undefined) {
            playPromise.catch((e) => console.error('Autoplay error:', e));
          }
        }
      };
      
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      while (candidatesQueue.current.length) {
        const candidate = candidatesQueue.current.shift();
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
      candidatesQueue.current = [];
      console.log(payload)
      if (payload.sdp) {
        setIncomingcall(true);
      }
      setAnswer(payload);
      console.log("sending answer")
    });

    socket.current.on('userBusy', ({ message }) => {
      setUserBusy(true);
      setIsCalling(false);
      setTarget(null);
      console.log(message);
    });

    socket.current.on('answer', async (payload) => {
      setCurrentUser((prev) => ({ ...prev, partner: payload.caller.id }));
      setIsCalling(false);
      setInCall(true);
      if (remoteVideo.current) {
        remoteVideo.current.srcObject = null;
      }
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      while (candidatesQueue.current.length) {
        const candidate = candidatesQueue.current.shift();
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
      candidatesQueue.current = [];
    });

    socket.current.on('call_declined', () => {
      console.log('call reject');
      resetCall();
      setCallDeclined(true);
    });

    socket.current.on('call_cancel', () => {
      
      resetCall();
      setVideoCall(false)
    });

    socket.current.on('call_ended', () => {
      setCallEnded(true);
      resetCall();
    });

    socket.current.on('ice-candidate', async (payload) => {
      candidatesQueue.current.push(payload.route);
      if (peerConnection.current && peerConnection.current.remoteDescription) {
        while (candidatesQueue.current.length) {
          const candidate = candidatesQueue.current.shift();
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      }
      console.log("recieved ice")
    });

    return () => {
      if (typingTimeout.current) {
        clearTimeout(typingTimeout.current);
      }
      if (localStream.current) {
        localStream.current.getTracks().forEach((track) => track.stop());
        localStream.current = null;
      }
      if (socket.current) {
        socket.current.disconnect();
        socket.current.off();
      }
    };
  }, []);

  useEffect(() => {
    if (videoCall && localStream.current && localVideo.current) {
      localVideo.current.srcObject = localStream.current;
    }
  }, [videoCall]);

  const createOffer = async ({ targetUser, user }) => {
    try {
      setVideoCall(true);
      setTarget(user);
      setIsCalling(true);

      if (!localStream.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStream.current = stream;
        if (localVideo.current) {
          localVideo.current.srcObject = stream;
        }
      }

      peerConnection.current = new RTCPeerConnection(configuration);
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          socket.current.emit('ice-candidate', { target: targetUser, route: event.candidate });
        }
      };
      peerConnection.current.ontrack = (event) => {
        const stream = event.streams[0];
        if (remoteVideo.current && remoteVideo.current.srcObject !== stream) {
          remoteVideo.current.srcObject = stream;
          const playPromise = remoteVideo.current.play();
          if (playPromise !== undefined) {
            playPromise.catch((e) => console.error('Autoplay error:', e));
          }
        }
      };

      localStream.current.getTracks().forEach((track) => {
        peerConnection.current.addTrack(track, localStream.current);
      });

      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);

      socket.current.emit('offer', {
        sdp: offer,
        target: targetUser,
        caller: { username: currentUser.username, id: socket.current.id },
      });
      console.log('sent offer to ', targetUser);
    } catch (error) {
      console.error('Error in createOffer:', error);
      alert('Failed to start call. Camera and microphone access is required.');
      setVideoCall(false);
      setIsCalling(false);
      setTarget(null);
      navigate('/');
    }
  };

  const createAnswer = async ({ payload }) => {
    try {
      setCurrentUser((prev) => ({ ...prev, partner: payload.caller.id }));

      if (!localStream.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStream.current = stream;
        if (localVideo.current) {
          localVideo.current.srcObject = stream;
        }
      }

      localStream.current.getTracks().forEach((track) => {
        peerConnection.current.addTrack(track, localStream.current);
      });

      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);
      socket.current.emit('answer', { target: payload.caller.id, sdp: answer, caller: currentUser });
    } catch (error) {
      console.error('Error in createAnswer:', error);
      alert('Failed to accept call. Camera and microphone access is required.');
      setIncomingcall(false);
    }
  };

  const sendAnswer = (answer) => {
    setVideoCall(true);
    createAnswer({ payload: answer });
    setIncomingcall(false);
    setInCall(true);
    console.log('call accepted');
    setCurrentUser((prev) => ({ ...prev, partner: answer.caller.id }));
  };

  const handleAudio = () => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach((audioTrack) => {
        audioTrack.enabled = !mute;
      });
      setMute(!mute);
    }
  };

  const handleVideo = () => {
    if (localStream.current) {
      localStream.current.getVideoTracks().forEach((videoTrack) => {
        videoTrack.enabled = !pause;
      });
      setPause(!pause);
    }
  };

  const resetCall = () => {
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => track.stop());
      localStream.current = null;
    }
    if (remoteVideo.current) {
      remoteVideo.current.srcObject = null;
    }
    if (localVideo.current) {
      localVideo.current.srcObject = null;
    }
    candidatesQueue.current = [];

    setInCall(false);
    setIncomingcall(false);
    setIsCalling(false);
    setAnswer(null);
    
    setTarget(null);
  };

  const handleCancelCall = () => {
    resetCall();
    socket.current.emit('call_canceled', { caller: socket.current.id, target });
    setVideoCall(false)
  };

  const handleRejectCall = () => {
    setIncomingcall(false);
    setVideoCall(false);
    socket.current.emit('call_reject', { targetUser: answer?.caller.id, callee: socket.current.id });
    resetCall();
  };

  const handleEnd = () => {
    resetCall();
    socket.current.emit('call_ended', { target: currentUser.partner, currentUser: currentUser.id });
    console.log('you are ending the call');
    setCallEnded(true)
  };

  if (isLoading) {
    return (
      <div className="chatbox">
        <div className="header">
          <h1>ChatterBox</h1>
        </div>
        <div className="loading-area">
          <h2 className="loading-text">Connecting to ChatterBox...</h2>
          <div className="loader"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="chatbox">
      {!videoCall && <div className="header">
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
                    <div className="user-info">
                      <span className="user-online-indicator">●</span>
                      <span className="username">{client.username}</span>
                    </div>
                    <button className="callbtn" onClick={() => createOffer({ targetUser: client.id, user:client })}>
                      <i className="fa-solid fa-video"></i>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )} 
        </div>
      </div>}
      {!videoCall &&

      <div className="messages-container">
        <ScrollToBottom className="messages">
          {messages.map((item) =>
            item.type === 'notification' ? (
              <h2 key={item.id} className="notification">{item.message}</h2>
            ) : (
              <Message key={item.id} data={item} currUserId={currUserId} />
            ),
          )}
        </ScrollToBottom>
        {typeMsg && <div className="typing-indicator">{typeMsg}</div>}
      </div>}
      {!videoCall &&
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
      </div>}

      {videoCall && (
    <div className="video-call-wrapper">
      <div className="video-container">
        <div className="remote-video-view">
          <video ref={remoteVideo} autoPlay playsInline></video>
          <div className="video-label">{target?.username || answer?.caller.username}</div>
        </div>

        <div className="local-video-view">
          <video ref={localVideo} autoPlay playsInline muted></video>
          <div className="video-label">You</div>
        </div>
      </div>

      <div className="video-controls">
        <button className="control-btn" onClick={handleAudio}>
          {mute ? <i className="fa-solid fa-microphone"></i> : <i className="fa-solid fa-microphone-slash"></i>}
        </button>
        <button className="control-btn" onClick={handleVideo}>
          {pause ?<i className="fa-solid fa-video"></i> : <i className="fa-solid fa-video-slash"></i> }
        </button>
        {inCall && (
          <button className="control-btn end-call-btn" onClick={handleEnd}>
            <i className="fa-solid fa-phone"></i>
          </button>
        )}
      </div>

      {incomingcall && (
  <div className="popup-overlay">
    <div className="popup incoming-call">
      <div className="caller-avatar">{answer?.caller.username.charAt(0)}</div>
      <h3>Incoming Call</h3>
      <p>
        <span className="caller-name">{answer?.caller.username}</span> is calling...
      </p>
      <div className="popup-actions">
        <button className="accept-btn" onClick={() => sendAnswer(answer)}>
          <i className="fa-solid fa-phone"></i> Accept
        </button>
        <button className="reject-btn" onClick={handleRejectCall}>
          <i className="fa-solid fa-phone-slash"></i> Reject
        </button>
      </div>
    </div>
  </div>
)}

{isCalling && (
  <div className="popup-overlay">
    <div className="popup calling">
      <div className="caller-avatar">{target?.username.charAt(0)}</div>
      <h3>Calling...</h3>
      <p>
        Ringing <span className="target-name">{target?.username}</span>
      </p>
      <div className="popup-actions">
        <button className="cancel-btn" onClick={handleCancelCall}>
          <i className="fa-solid fa-phone-slash"></i> Cancel
        </button>
      </div>
    </div>
  </div>
)}

{userBusy && (
  <div className="popup-overlay">
    <div className="popup">
      <div className="popup-icon warning">
        <i className="fa-solid fa-user-slash"></i>
      </div>
      <h3>User Busy</h3>
      <p>The user is currently in another call.</p>
      <div className="popup-actions">
        <button className="ok-btn" onClick={() => { setUserBusy(false); setVideoCall(false); }}>
          OK
        </button>
      </div>
    </div>
  </div>
)}

{callDeclined && (
  <div className="popup-overlay">
    <div className="popup">
      <div className="popup-icon error">
        <i className="fa-solid fa-ban"></i>
      </div>
      <h3>Call Declined</h3>
      <p>{target?.username || 'The user'} declined your call.</p>
      <div className="popup-actions">
        <button className="ok-btn" onClick={() => { setCallDeclined(false); setTarget(null); setVideoCall(false); }}>
          OK
        </button>
      </div>
    </div>
  </div>
)}

{callEnded && (
  <div className="popup-overlay">
    <div className="popup">
      <div className="popup-icon success">
        <i className="fa-solid fa-circle-check"></i>
      </div>
      <h3>Call Ended</h3>
      <p>Your call has ended.</p>
      <div className="popup-actions">
        <button className="ok-btn" onClick={() => { setCallEnded(false); setVideoCall(false); }}>
          OK
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  )}
    </div>
  );
}

export default Home;