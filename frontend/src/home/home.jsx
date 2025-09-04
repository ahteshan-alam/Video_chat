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



  // animation by grok ai


  useEffect(() => {
    const localVideoEl = localVideo.current;
    const remoteVideoEl = remoteVideo.current;
  
    const handleCanPlay = (containerClass) => {
      return () => {
        const container = document.querySelector(containerClass);
        if (container) {
          container.classList.add('video-loaded');
        }
      };
    };
  
    if (localVideoEl) {
      localVideoEl.addEventListener('canplay', handleCanPlay('.local-video-container'));
    }
    if (remoteVideoEl) {
      remoteVideoEl.addEventListener('canplay', handleCanPlay('.remote-video-container'));
    }
  
    return () => {
      if (localVideoEl) {
        localVideoEl.removeEventListener('canplay', handleCanPlay('.local-video-container'));
      }
      if (remoteVideoEl) {
        remoteVideoEl.removeEventListener('canplay', handleCanPlay('.remote-video-container'));
      }
    };
  }, []);


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
    setVideoCall(false);
    setTarget(null);
  };

  const handleCancelCall = () => {
    resetCall();
    socket.current.emit('call_canceled', { caller: socket.current.id, target });
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
    <div className="App">
      {!videoCall && (
        <div className="no-call">
          <header className="app-header">
            <h1>My Video Call App {currentUser.username}</h1>
          </header>
          <main className="main-content">
            <section className="no-call-section">
              <h2>Welcome to Video Chat</h2>
              <p>Select a user to start a call.</p>
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
                            className="control-btn call-btn"
                            onClick={() => createOffer({ targetUser: user.id, user })}
                          >
                            <i className="fas fa-phone"></i> Call
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="no-users">No users online</li>
                    )}
                  </ul>
                </div>
              </div>
            </aside>
          </main>
        </div>
      )}
      {videoCall && (
        <div className="video-call-container">
          <header className="app-header">
            <h1>My Video Call App {currentUser.username}</h1>
          </header>
          <main className="main-content">
            <section className="video-section">
              <div className="video">
                <div className="local-video-container">
                  <video ref={localVideo} autoPlay playsInline muted></video>
                  <div className="video-label">You</div>
                </div>
                <div className="remote-video-container">
                  <video ref={remoteVideo} autoPlay playsInline></video>
                  <div className="video-label">{target?.username || 'Remote'}</div>
                </div>
              </div>
              <div className="video-controls">
                <button className="control-btn mute-btn" onClick={handleAudio}>
                  {mute ? (
                    <span className="icon"><i className="fas fa-microphone-slash"></i> Unmute</span>
                  ) : (
                    <span className="icon"><i className="fas fa-microphone"></i> Mute</span>
                  )}
                </button>
                <button className="control-btn video-btn" onClick={handleVideo}>
                  {pause ? (
                    <span className="icon"><i className="fas fa-video"></i> Resume</span>
                  ) : (
                    <span className="icon"><i className="fas fa-video-slash"></i> Pause</span>
                  )}
                </button>
                {inCall && (
                  <button className="control-btn end-call-btn" onClick={handleEnd}>
                    <span className="icon"><i className="fas fa-phone-slash"></i> End Call</span>
                  </button>
                )}
              </div>
              {inCall && (
                <div className="call-status">
                  <span>Call with {target?.username || 'Remote'}</span>
                </div>
              )}
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
                            className="control-btn call-btn"
                            onClick={() => createOffer({ targetUser: user.id, user })}
                            disabled={inCall || isCalling}
                          >
                            <i className="fas fa-phone"></i> Call
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="no-users">No users online</li>
                    )}
                  </ul>
                </div>
              </div>
            </aside>
          </main>
          {incomingcall && (
            <div className="popup-overlay">
              <div className="popup incoming-call">
                <div className="popup-icon"><i className="fas fa-phone"></i></div>
                <h3>Incoming Call</h3>
                <p>
                  Call from <span className="caller-name">{answer?.caller.username}</span>
                </p>
                <div className="popup-actions">
                  <button className="control-btn accept-btn" onClick={() => sendAnswer(answer)}>
                    <i className="fas fa-check"></i> Accept
                  </button>
                  <button className="control-btn reject-btn" onClick={handleRejectCall}>
                    <i className="fas fa-times"></i> Reject
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
                  <button className="control-btn cancel-btn" onClick={handleCancelCall}>
                    <i className="fas fa-times"></i> Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
          {userBusy && (
            <div className="popup-overlay">
              <div className="popup user-busy">
                <div className="popup-icon"><i className="fas fa-user-slash"></i></div>
                <h3>User Busy</h3>
                <p>User busy in another call</p>
                <div className="popup-actions">
                  <button
                    className="control-btn ok-btn"
                    onClick={() => {
                      setUserBusy(false);
                      setVideoCall(false);
                    }}
                  >
                    <i className="fas fa-check"></i> OK
                  </button>
                </div>
              </div>
            </div>
          )}
          {callDeclined && (
            <div className="popup-overlay">
              <div className="popup call-rejected">
                <div className="popup-icon"><i className="fas fa-times"></i></div>
                <h3>Call Declined</h3>
                <p>{target?.username || 'The user'} declined your call</p>
                <div className="popup-actions">
                  <button
                    className="control-btn ok-btn"
                    onClick={() => {
                      setCallDeclined(false);
                      setTarget(null);
                      setVideoCall(false);
                    }}
                  >
                    <i className="fas fa-check"></i> OK
                  </button>
                </div>
              </div>
            </div>
          )}
          {callEnded && (
            <div className="popup-overlay">
              <div className="popup call-ended">
                <div className="popup-icon"><i className="fas fa-phone-slash"></i></div>
                <h3>Call Ended</h3>
                <p>Call ended</p>
                <div className="popup-actions">
                  <button
                    className="control-btn ok-btn"
                    onClick={() => {
                      setCallEnded(false);
                      setVideoCall(false);
                    }}
                  >
                    <i className="fas fa-check"></i> OK
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