
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
  let [callDeclined, setCallDeclined] = useState(false)
  let [callEnded, setCallEnded] = useState(false)
  const candidatesQueue = useRef([]);
  const location = useLocation()
  const formData = location.state?.formData
  const localVideo = useRef()
  const localStream = useRef()
  const remoteVideo = useRef()
  const socket = useRef()
  const peerConnection = useRef()
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
        socket.current.on('connect', () => {
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
          console.log(`offer recieved from ${payload.caller.id} to ${payload.target}`)
          if (peerConnection.current || inCall) {
            socket.current.emit("userBusy", { target: payload.caller.id });
            return;
          }
          peerConnection.current = new RTCPeerConnection(configuration)
          peerConnection.current.onicecandidate = (event) => {
            if (event.candidate) {
              socket.current.emit('ice-candidate', { target: payload.caller.id, route: event.candidate })
            }
          }
          peerConnection.current.ontrack = (event) => {
            const stream = event.streams[0];
            if (remoteVideo.current.srcObject !== stream) {
              remoteVideo.current.srcObject = stream;
              const playPromise = remoteVideo.current.play();
              if (playPromise !== undefined) {
                playPromise.catch(e => console.error('Autoplay error:', e));
              }
            }
          };
          remoteVideo.current.srcObject = null;

          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp))
          while (candidatesQueue.current.length) {
            const candidate = candidatesQueue.current.shift();
            await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
          }
          candidatesQueue.current = []
          if (payload.sdp) {
            setIncomingcall(true)
          }
          setAnswer(payload)
        })
        socket.current.on('userBusy', ({ message }) => {
          setUserBusy(true)
          setIsCalling(false)
          setTarget(null)
          console.log(message)
        })
        socket.current.on('answer', async (payload) => {
          setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }))
          setIsCalling(false)
          setInCall(true)
          remoteVideo.current.srcObject = null;
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp))
          while (candidatesQueue.current.length) {
            const candidate = candidatesQueue.current.shift();
            await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
          }
          candidatesQueue.current = []

        })
        socket.current.on('call_declined', () => {
          console.log('call reject')
          resetCall()
          setCallDeclined(true)
        })
        socket.current.on('call_cancel', () => {
          resetCall()
        })
        socket.current.on('call_ended', () => {

          setCallEnded(true)
          resetCall()
        })



        socket.current.on('ice-candidate', async (payload) => {
          candidatesQueue.current.push(payload.route);
          if (peerConnection.current && peerConnection.current.remoteDescription) {
            while (candidatesQueue.current.length) {
              const candidate = candidatesQueue.current.shift();
              await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate))
            }

          }




        })

        return () => {
          if (socket.current) {
            socket.current.disconnect()
            socket.current.off()
          }


        }
      })






  }, [])

  const createOffer = async ({ targetUser, user }) => {
    setTarget(user)

    console.log("sending offer to ", targetUser)
    setIsCalling(true)
    if (!localStream.current) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      localStream.current = stream
      localVideo.current.srcObject = stream
    }
    peerConnection.current = new RTCPeerConnection(configuration)
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.current.emit('ice-candidate', { target: targetUser, route: event.candidate })
      }
    }
    peerConnection.current.ontrack = (event) => {
      const stream = event.streams[0]
      if (remoteVideo.current.srcObject !== stream) {
        remoteVideo.current.srcObject = stream
        const playPromise = remoteVideo.current.play();
        if (playPromise !== undefined) {
          playPromise.catch(e => console.error('Autoplay error:', e));
        }
      }

    }
    localStream.current.getTracks().forEach(track => {
      peerConnection.current.addTrack(track, localStream.current)
    })

    const offer = await peerConnection.current.createOffer()
    await peerConnection.current.setLocalDescription(offer)

    socket.current.emit('offer', { sdp: offer, target: targetUser, caller: { username: currentUser.username, id: socket.current.id } })
    console.log("sent offer to ", targetUser)


  }
  const createAnswer = async ({ payload }) => {
    setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }))
    if (!localStream.current) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      localStream.current = stream
      localVideo.current.srcObject = stream
    }


    localStream.current.getTracks().forEach(track => {
      peerConnection.current.addTrack(track, localStream.current)
    })

    const answer = await peerConnection.current.createAnswer()
    await peerConnection.current.setLocalDescription(answer)
    socket.current.emit('answer', { target: payload.caller.id, sdp: answer, caller: currentUser })

  }
  const sendAnswer = (answer) => {

    createAnswer({ payload: answer })

    setIncomingcall(false)
    setInCall(true)
    console.log("call accepted")
    setCurrentUser(prev => ({ ...prev, partner: answer.caller.id }))

  }
  const handleAudio = () => {
    mute ? (localStream.current.getAudioTracks().forEach(audioTrack => audioTrack.enabled = true), setMute(false)) : (localStream.current.getAudioTracks().forEach(audioTrack => audioTrack.enabled = false), setMute(true))


  }
  const resetCall = () => {
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }
    if (remoteVideo.current) {
      remoteVideo.current.srcObject = null;
    }
    candidatesQueue.current = [];

    setInCall(false);
    setIncomingcall(false);
    setIsCalling(false);
    setAnswer(null);

  }
  const handleVideo = () => {
    pause ? (localStream.current.getVideoTracks().forEach(videoTrack => videoTrack.enabled = true), setPause(false)) : (localStream.current.getVideoTracks().forEach(videoTrack => videoTrack.enabled = false), setPause(true))
  }
  const handleCancelCall = () => {
    resetCall()
    socket.current.emit('call_canceled', { caller: socket.current.id })

  }
  const handleRejectCall = () => {
    setIncomingcall(false)
    socket.current.emit('call_reject', { targetUser: answer.caller.id, callee: socket.current.id })
    resetCall()

  }
  const handleEnd = () => {

    resetCall()
    socket.current.emit('call_ended', { target: currentUser.partner, currentUser: currentUser.id })
    console.log("you are ending the call")

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
              <button className="ok-btn" onClick={() => setUserBusy(false)}>ok</button>
            </div>
          </div>
        </div>
      }

      {callDeclined &&
        <div className="popup-overlay">
          <div className="popup call-rejected">
            <div className="popup-icon">❌</div>
            <h3>Call Declined</h3>
            <p>{target.username} declined your call</p>
            <div className="popup-actions">
              <button className="ok-btn" onClick={() => { setCallDeclined(false), setTarget() }}>ok</button>

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