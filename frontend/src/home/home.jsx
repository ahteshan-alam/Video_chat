// Home.jsx
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './home.css';
import { io } from 'socket.io-client';

const configuration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:global.xirsys.net"] },
    {
      urls: [
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
  const [callReject, setCallReject] = useState(false);
  const [callEnded, setCallEnded] = useState(false);

  // new state to show UI if autoplay blocked
  const [needsUserAction, setNeedsUserAction] = useState(false);

  const location = useLocation();
  const formData = location.state?.formData;
  const navigate = useNavigate();

  const localVideo = useRef(null);
  const localStream = useRef(null);
  const remoteVideo = useRef(null);
  const socket = useRef(null);
  const peerConnection = useRef(null);

  // keep references to the gesture handler so we can remove it later
  const resumeHandlersRef = useRef({ click: null, touch: null });

  useEffect(() => {
    if (!formData) {
      navigate('/');
      return;
    }

    // get local camera/mic immediately
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localStream.current = stream;
        if (localVideo.current) localVideo.current.srcObject = stream;

        socket.current = io("https://video-chat-9zhu.onrender.com/");

        socket.current.on('connect', () => {
          setCurrentUser({ username: formData.username, id: socket.current.id });
          socket.current.emit('new-user', { id: socket.current.id, formData });
        });

        socket.current.on('user-joined', ({ message, members }) => {
          setOtherusers(members.filter((c) => c.id !== socket.current.id));
          console.log(message);
        });

        socket.current.on('welcome', ({ message, members }) => {
          setOtherusers(members.filter((c) => c.id !== socket.current.id));
          console.log(message);
        });

        socket.current.on('user-left', ({ message, members }) => {
          setOtherusers(members.filter(c => c.id !== socket.current.id));
          console.log(message);
        });

        socket.current.on('offer', (payload) => {
          console.log(`offer recieved from ${payload.caller.id} to ${payload.target}`);
          if (payload.sdp) setIncomingcall(true);
          setAnswer(payload);
        });

        socket.current.on('userBusy', ({ message }) => {
          setUserBusy(true);
          setIsCalling(false);
          setTarget(null);
          console.log(message);
        });

        socket.current.on('answer', (payload) => {
          setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }));
          setIsCalling(false);
          setInCall(true);
          try {
            peerConnection.current?.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          } catch (e) {
            console.warn('setRemoteDescription error:', e);
          }
        });

        socket.current.on('call_reject', () => {
          setIsCalling(false);
          setCallReject(true);
          console.log('call reject');
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
            try { peerConnection.current.close(); } catch {}
            peerConnection.current = null;
          }
          localStream.current = null;
          setTarget(null);
          setInCall(false);
        });

        socket.current.on('ice-candidate', (payload) => {
          if (peerConnection.current) {
            try {
              peerConnection.current.addIceCandidate(new RTCIceCandidate(payload.route));
            } catch (e) {
              console.warn('addIceCandidate error:', e);
            }
          }
        });

      })
      .catch(err => {
        console.error('getUserMedia error', err);
        // you might prompt the user to allow camera/mic
      });

    return () => {
      // cleanup socket + pc + streams on unmount
      try {
        socket.current?.off();
        socket.current?.disconnect();
      } catch {}
      try { peerConnection.current?.close(); } catch {}
      try {
        if (localStream.current) localStream.current.getTracks().forEach(t => t.stop());
      } catch {}
      localStream.current = null;
      // remove any gesture listeners
      removeResumeHandlers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- autoplay/resume helpers ----------
  const removeResumeHandlers = () => {
    const { click, touch } = resumeHandlersRef.current;
    if (click) document.removeEventListener('click', click);
    if (touch) document.removeEventListener('touchstart', touch);
    resumeHandlersRef.current = { click: null, touch: null };
  };

  const handleRemoteStream = (stream) => {
    if (!remoteVideo.current) return;
    // set muted true initially — increases autoplay chances
    remoteVideo.current.muted = true;
    remoteVideo.current.srcObject = stream;

    // try to play. if blocked, show UI for user to start/unmute
    const playPromise = remoteVideo.current.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        // played — keep muted state until user toggles (we can unmute automatically if you prefer)
        setNeedsUserAction(false);
        removeResumeHandlers();
      }).catch((err) => {
        console.warn('Autoplay blocked or interrupted:', err);
        setNeedsUserAction(true);

        // register ONE-TIME gesture handlers to resume playback
        const resume = async () => {
          try {
            await remoteVideo.current.play();
            // keep it muted until user taps unmute button
            setNeedsUserAction(false);
            removeResumeHandlers();
          } catch (e) {
            console.warn('User gesture play failed:', e);
          }
        };

        // store refs to remove later
        resumeHandlersRef.current.click = resume;
        resumeHandlersRef.current.touch = resume;
        document.addEventListener('click', resumeHandlersRef.current.click, { once: true });
        document.addEventListener('touchstart', resumeHandlersRef.current.touch, { once: true });
      });
    }
  };

  // ---------- signaling / peer connection ----------
  const createPeer = () => {
    if (peerConnection.current) return peerConnection.current;

    const pc = new RTCPeerConnection(configuration);

    pc.onicecandidate = (event) => {
      if (event.candidate && target?.id) {
        socket.current.emit('ice-candidate', { target: target.id, route: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      // event.streams[0] should exist in most browsers
      if (event.streams && event.streams[0]) {
        handleRemoteStream(event.streams[0]);
      } else if (event.track) {
        // fallback: create MediaStream from track
        const ms = new MediaStream([event.track]);
        handleRemoteStream(ms);
      }
    };

    peerConnection.current = pc;
    return pc;
  };

  const addLocalTracksToPeer = () => {
    if (!peerConnection.current || !localStream.current) return;
    const senders = peerConnection.current.getSenders();
    localStream.current.getTracks().forEach(track => {
      const already = senders.find(s => s.track && s.track.kind === track.kind);
      if (!already) peerConnection.current.addTrack(track, localStream.current);
    });
  };

  // ---------- actions ----------
  const createOffer = async ({ targetUser, user }) => {
    setTarget(user);
    console.log('sending offer to', targetUser);
    setIsCalling(true);

    if (!localStream.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStream.current = stream;
        if (localVideo.current) localVideo.current.srcObject = stream;
      } catch (e) {
        console.error('getUserMedia failed on call', e);
        setIsCalling(false);
        return;
      }
    }

    createPeer();
    addLocalTracksToPeer();

    try {
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      socket.current.emit('offer', {
        sdp: offer,
        target: targetUser,
        caller: { username: currentUser.username, id: socket.current.id }
      });
      console.log('sent offer to', targetUser);
    } catch (e) {
      console.error('createOffer error', e);
      setIsCalling(false);
    }
  };

  const createAnswer = async ({ payload }) => {
    setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }));

    if (!localStream.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStream.current = stream;
        if (localVideo.current) localVideo.current.srcObject = stream;
      } catch (e) {
        console.error('getUserMedia failed for answer', e);
        return;
      }
    }

    createPeer();
    addLocalTracksToPeer();

    try {
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answerDesc = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answerDesc);
      socket.current.emit('answer', { target: payload.caller.id, sdp: answerDesc, caller: currentUser });

      // After accepting it's safe to attempt play (user just interacted by tapping "Accept")
      // unmute and attempt play
      if (remoteVideo.current) {
        remoteVideo.current.muted = false; // allow audio immediately because user tapped Accept
        remoteVideo.current.play().catch(e => console.warn('play after accept failed:', e));
      }

      setInCall(true);
    } catch (e) {
      console.error('createAnswer error', e);
    }
  };

  const sendAnswer = (answerPayload) => {
    if (!answerPayload) return;
    createAnswer({ payload: answerPayload });
    setIncomingcall(false);
    setAnswer(null);
    setCurrentUser(prev => ({ ...prev, partner: answerPayload.caller.id }));
    console.log('call accepted');
  };

  const handleAudio = () => {
    if (!localStream.current) return;
    const audios = localStream.current.getAudioTracks();
    if (!audios.length) return;
    const newMute = !mute;
    audios.forEach(t => t.enabled = !newMute);
    setMute(newMute);
  };

  const handleVideo = () => {
    if (!localStream.current) return;
    const videos = localStream.current.getVideoTracks();
    if (!videos.length) return;
    const newPause = !pause;
    videos.forEach(t => t.enabled = !newPause);
    setPause(newPause);
  };

  const handleCancelCall = () => {
    setIsCalling(false);
    socket.current.emit('call_canceled', { target, caller: socket.current.id });
    setTarget(null);
  };

  const handleRejectCall = () => {
    setIncomingcall(false);
    if (answer?.caller?.id) {
      socket.current.emit('call_reject', { targetUser: answer.caller.id, callee: socket.current.id });
    }
  };

  const handleEnd = () => {
    if (currentUser.partner) {
      socket.current.emit('call_ended', { target: currentUser.partner, currentUser: currentUser.id });
    }
    setTarget(null);
    setInCall(false);
    setCallEnded(true);

    try {
      peerConnection.current?.close();
    } catch {}
    peerConnection.current = null;

    try {
      localStream.current?.getTracks().forEach(t => t.stop());
    } catch {}
    localStream.current = null;

    // remote video cleanup
    if (remoteVideo.current) {
      remoteVideo.current.srcObject = null;
      remoteVideo.current.muted = true;
    }
  };

  // UI button to resume/unmute remote playback when autoplay blocked
  const handleStartRemote = async () => {
    if (!remoteVideo.current) return;
    try {
      // unmute the remote audio so user hears it
      remoteVideo.current.muted = false;
      await remoteVideo.current.play();
      setNeedsUserAction(false);
      removeResumeHandlers();
    } catch (e) {
      console.warn('Start remote failed:', e);
    }
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
              {/* remote video starts muted to improve autoplay chances */}
              <video ref={remoteVideo} autoPlay playsInline muted></video>
              <div className="video-label">Remote</div>

              {needsUserAction && (
                <div className="tap-to-unmute">
                  <button onClick={handleStartRemote}>Start Remote Video / Unmute</button>
                </div>
              )}
            </div>
          </div>

          <div className="video-controls">
            <button className='muteBtn' onClick={handleAudio}>{mute ? 'unmute' : 'mute'}</button>
            <button className='muteBtn' onClick={handleVideo}>{pause ? 'video on' : 'video off'}</button>
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
                {otherusers.length > 0 ? otherusers.map(user => (
                  <li key={user.id} className="user-item">
                    <span className="user-info">
                      <span className="online-indicator"></span>
                      <span className="username">{user.username}</span>
                    </span>
                    <button className="call-btn" onClick={() => createOffer({ targetUser: user.id, user })}>call</button>
                  </li>
                )) : (<li className="no-users">no users online</li>)}
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
            <p>Call from <span className="caller-name">{answer?.caller?.username}</span></p>
            <div className="popup-actions">
              <button className="accept-btn" onClick={() => sendAnswer(answer)}>Accept</button>
              <button className="reject-btn" onClick={handleRejectCall}>Reject</button>
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
              <button className="cancel-btn" onClick={handleCancelCall}>cancel</button>
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
              <button className="ok-btn" onClick={() => setUserBusy(false)}>ok</button>
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
              <button className="ok-btn" onClick={() => { setCallReject(false); setTarget(null); }}>ok</button>
              {target && <button className="retry-btn" onClick={() => { createOffer({ targetUser: target.id, user: target }); setCallReject(false); }}>call Again</button>}
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
              <button className="ok-btn" onClick={() => setCallEnded(false)}>ok</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Home;
