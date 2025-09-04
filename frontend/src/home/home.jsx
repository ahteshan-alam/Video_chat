import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './home.css';
import { io } from 'socket.io-client';
import ScrollToBottom from 'react-scroll-to-bottom';
import Message from '../message/message';// Assuming Message component is defined elsewhere

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
  const [mute, setMute] = useState(false);
  const [pause, setPause] = useState(false);
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
                    <button className="callbtn" onClick={() => createOffer({ targetUser: client.id, user: client })}>
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
        <div className="video-call-app">
          <div className="cyber-grid"></div>
          <div className="cyber-overlay"></div>

          <header className="app-header">
            <div className="header-content">
              <div className="logo-section">
                <div className="cyber-logo">
                  <span className="logo-icon">◉</span>
                  <h1 className="app-title">NEXUS CALL</h1>
                </div>
                <div className="user-badge">
                  <span className="user-indicator"></span>
                  <span className="username">{currentUser.username}</span>
                </div>
              </div>
              <div className="connection-status">
                <div className="status-dot"></div>
                <span>CONNECTED</span>
              </div>
            </div>
          </header>

          <main className="main-content">
            <section className="video-arena">
              <div className="video-grid">
                <div className="video-container local-video">
                  <div className="video-frame">
                    <video ref={localVideo} autoPlay playsInline muted></video>
                    <div className="video-overlay">
                      <div className="scan-line"></div>
                      <div className="corner-brackets">
                        <span className="bracket top-left"></span>
                        <span className="bracket top-right"></span>
                        <span className="bracket bottom-left"></span>
                        <span className="bracket bottom-right"></span>
                      </div>
                    </div>
                  </div>
                  <div className="video-label">
                    <span className="label-text">LOCAL_FEED</span>
                    <div className="signal-bars">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                </div>

                <div className="video-container remote-video">
                  <div className="video-frame">
                    <video ref={remoteVideo} autoPlay playsInline></video>
                    <div className="video-overlay">
                      <div className="scan-line"></div>
                      <div className="corner-brackets">
                        <span className="bracket top-left"></span>
                        <span className="bracket top-right"></span>
                        <span className="bracket bottom-left"></span>
                        <span className="bracket bottom-right"></span>
                      </div>
                    </div>
                  </div>
                  <div className="video-label">
                    <span className="label-text">REMOTE_FEED</span>
                    <div className="signal-bars">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="control-panel">
                <div className="control-group">
                  <button className={`cyber-btn audio-btn ${mute ? 'muted' : ''}`} onClick={handleAudio}>
                    <span className="btn-icon">{mute ? '🔇' : '🎤'}</span>
                    <span className="btn-text">{mute ? 'UNMUTE' : 'MUTE'}</span>
                    <div className="btn-glow"></div>
                  </button>

                  <button className={`cyber-btn video-btn ${pause ? 'paused' : ''}`} onClick={handleVideo}>
                    <span className="btn-icon">📹</span>
                    <span className="btn-text">{pause ? 'RESUME' : 'PAUSE'}</span>
                    <div className="btn-glow"></div>
                  </button>

                  {inCall && (
                    <button className="cyber-btn end-btn" onClick={handleEnd}>
                      <span className="btn-icon">❌</span>
                      <span className="btn-text">END_CALL</span>
                      <div className="btn-glow"></div>
                    </button>
                  )}
                </div>
              </div>
            </section>
          </main>

          {/* Incoming Call Modal */}
          {incomingcall && (
            <div className="modal-overlay">
              <div className="modal-container incoming-call-modal">
                <div className="modal-header">
                  <div className="pulse-ring">
                    <span className="call-icon">📞</span>
                  </div>
                  <h3 className="modal-title">INCOMING_TRANSMISSION</h3>
                </div>
                <div className="modal-body">
                  <p className="caller-info">
                    CALLER: <span className="caller-name">{answer?.caller.username}</span>
                  </p>
                  <div className="connection-visual">
                    <div className="data-stream"></div>
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="cyber-btn accept-btn" onClick={() => sendAnswer(answer)}>
                    <span className="btn-text">ACCEPT</span>
                    <div className="btn-glow"></div>
                  </button>
                  <button className="cyber-btn reject-btn" onClick={handleRejectCall}>
                    <span className="btn-text">REJECT</span>
                    <div className="btn-glow"></div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Calling Modal */}
          {isCalling && (
            <div className="modal-overlay">
              <div className="modal-container calling-modal">
                <div className="modal-header">
                  <div className="loading-ring">
                    <div className="spinner"></div>
                  </div>
                  <h3 className="modal-title">ESTABLISHING_CONNECTION</h3>
                </div>
                <div className="modal-body">
                  <p className="target-info">
                    TARGET: <span className="target-name">{target?.username}</span>
                  </p>
                  <div className="connection-bars">
                    <span></span><span></span><span></span><span></span>
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="cyber-btn cancel-btn" onClick={handleCancelCall}>
                    <span className="btn-text">ABORT</span>
                    <div className="btn-glow"></div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* User Busy Modal */}
          {userBusy && (
            <div className="modal-overlay">
              <div className="modal-container error-modal">
                <div className="modal-header">
                  <div className="error-icon">📵</div>
                  <h3 className="modal-title">CONNECTION_BLOCKED</h3>
                </div>
                <div className="modal-body">
                  <p className="error-message">TARGET_BUSY_IN_ANOTHER_CALL</p>
                </div>
                <div className="modal-actions">
                  <button className="cyber-btn ok-btn" onClick={() => {
                    setUserBusy(false);
                    setVideoCall(false);
                  }}>
                    <span className="btn-text">ACKNOWLEDGED</span>
                    <div className="btn-glow"></div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Call Declined Modal */}
          {callDeclined && (
            <div className="modal-overlay">
              <div className="modal-container error-modal">
                <div className="modal-header">
                  <div className="error-icon">❌</div>
                  <h3 className="modal-title">TRANSMISSION_DENIED</h3>
                </div>
                <div className="modal-body">
                  <p className="error-message">
                    {target?.username || 'TARGET'} REJECTED_CONNECTION
                  </p>
                </div>
                <div className="modal-actions">
                  <button className="cyber-btn ok-btn" onClick={() => {
                    setCallDeclined(false);
                    setTarget(null);
                    setVideoCall(false);
                  }}>
                    <span className="btn-text">ACKNOWLEDGED</span>
                    <div className="btn-glow"></div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Call Ended Modal */}
          {callEnded && (
            <div className="modal-overlay">
              <div className="modal-container info-modal">
                <div className="modal-header">
                  <div className="info-icon">📴</div>
                  <h3 className="modal-title">CONNECTION_TERMINATED</h3>
                </div>
                <div className="modal-body">
                  <p className="info-message">TRANSMISSION_ENDED</p>
                </div>
                <div className="modal-actions">
                  <button className="cyber-btn ok-btn" onClick={() => {
                    setCallEnded(false);
                    setVideoCall(false);
                  }}>
                    <span className="btn-text">ACKNOWLEDGED</span>
                    <div className="btn-glow"></div>
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