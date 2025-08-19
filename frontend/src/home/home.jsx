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
  ]
};

function Home() {
  let [otherusers, setOtherusers] = useState([])
  let [currentUser, setCurrentUser] = useState({})
  let [incomingcall, setIncomingcall] = useState(false)
  let [isCalling, setIsCalling] = useState(false)
  let [userBusy, setUserBusy] = useState(false)
  let [pendingOffer, setPendingOffer] = useState(null) // New: store incoming offer for early PC setup
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
  const candidatesQueue = useRef([]) // For queuing ICE candidates if remote description not set yet
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
          if (inCall) {
              socket.current.emit('userBusy', {target: payload.caller.id})
              return;
          }
          if (payload.sdp) {
            candidatesQueue.current = [] 
            peerConnection.current = new RTCPeerConnection(configuration)
            peerConnection.current.onicecandidate = (event) => {
              if (event.candidate) {
                socket.current.emit('ice-candidate', { target: payload.caller.id, route: event.candidate })
              }
            }
            peerConnection.current.ontrack = (event) => {
              remoteVideo.current.srcObject = event.streams[0]
              console.log('Remote tracks:', event.streams[0].getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, muted: t.muted })));
            }
            peerConnection.current.onicecandidateerror = (e) => console.error('ICE error:', e);
            peerConnection.current.onconnectionstatechange = () => console.log('Connection state:', peerConnection.current.connectionState);
            peerConnection.current.oniceconnectionstatechange = () => console.log('ICE connection state:', peerConnection.current.iceConnectionState);
            peerConnection.current.onsignalingstatechange = () => console.log('Signaling state:', peerConnection.current.signalingState);
            peerConnection.current.onicegatheringstatechange = () => console.log('ICE gathering state:', peerConnection.current.iceGatheringState);
            
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp))
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
          setCurrentUser(prev => ({ ...prev, partner: payload.caller.id }))
          setIsCalling(false)
          setInCall(true)
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp))
          await flushCandidatesQueue() 
        })
        socket.current.on('call_reject', () => {
          console.log('call reject')
          setIsCalling(false)
          setCallReject(true)
        })
        socket.current.on('call_cancel', () => {
          setIncomingcall(false)
        })
        socket.current.on('call_ended', () => {
          setCallEnded(true)
          if (localStream.current) {
            localStream.current.getTracks().forEach(track => track.stop());
          }
          if (peerConnection.current) {
            peerConnection.current.close();
          }
          localStream.current = null;
          setTarget(null)
          setInCall(false);
          peerConnection.current = null;
        })

        socket.current.on('ice-candidate', async (payload) => {
          if (peerConnection.current && peerConnection.current.remoteDescription) {
            await peerConnection.current.addIceCandidate(new RTCIceCandidate(payload.route))
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
        }
      })
  }, [])
  
  const flushCandidatesQueue = async () => {
    while (candidatesQueue.current.length > 0) {
      const candidate = candidatesQueue.current.shift();
      try {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Added queued ICE candidate')
      } catch (e) {
        console.error('Error adding queued ICE candidate:', e)
      }
    }
  }
  
  const createOffer = async ({ targetUser, user }) => {
    setTarget(user)
    console.log("sending offer to ", targetUser)
    setIsCalling(true)
    if (!localStream.current) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      localStream.current = stream
      localVideo.current.srcObject = stream
    }
    candidatesQueue.current = [] 
    peerConnection.current = new RTCPeerConnection(configuration)
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.current.emit('ice-candidate', { target: targetUser, route: event.candidate })
      }
    }
    peerConnection.current.ontrack = (event) => {
      remoteVideo.current.srcObject = event.streams[0]
      console.log('Remote tracks:', event.streams[0].getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, muted: t.muted })));
    }
    peerConnection.current.onicecandidateerror = (e) => console.error('ICE error:', e);
    peerConnection.current.onconnectionstatechange = () => console.log('Connection state:', peerConnection.current.connectionState);
    peerConnection.current.oniceconnectionstatechange = () => console.log('ICE connection state:', peerConnection.current.iceConnectionState);
    peerConnection.current.onsignalingstatechange = () => console.log('Signaling state:', peerConnection.current.signalingState);
    peerConnection.current.onicegatheringstatechange = () => console.log('ICE gathering state:', peerConnection.current.iceGatheringState);
    localStream.current.getTracks().forEach(track => {
      peerConnection.current.addTrack(track, localStream.current)
    })

    const offer = await peerConnection.current.createOffer()
    await peerConnection.current.setLocalDescription(offer)

    socket.current.emit('offer', { sdp: offer, target: targetUser, caller: { username: currentUser.username, id: socket.current.id } })
    console.log("sent offer to ", targetUser)
  }
  
  const createAnswer = async () => {
    setCurrentUser(prev => ({ ...prev, partner: pendingOffer.caller.id }))
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
    await flushCandidatesQueue() 
    socket.current.emit('answer', { target: pendingOffer.caller.id, sdp: answer, caller: currentUser })
    setPendingOffer(null) 
  }
  
  const sendAnswer = () => {
    createAnswer()
    setIncomingcall(false)
    setInCall(true)
    console.log("call accepted")
    setCurrentUser(prev => ({ ...prev, partner: pendingOffer.caller.id }))
  }
  
  const handleAudio = () => {
    mute ? (localStream.current.getAudioTracks().forEach(audioTrack => audioTrack.enabled = true), setMute(false)) : (localStream.current.getAudioTracks().forEach(audioTrack => audioTrack.enabled = false), setMute(true))
  }
  
  const handleVideo = () => {
    pause ? (localStream.current.getVideoTracks().forEach(videoTrack => videoTrack.enabled = true), setPause(false)) : (localStream.current.getVideoTracks().forEach(videoTrack => videoTrack.enabled = false), setPause(true))
  }
  
  const handleCancelCall = () => {
    setIsCalling(false)
    socket.current.emit('call_canceled', { target: target.id, caller: socket.current.id })
    setTarget(null)
  }
  
  const handleRejectCall = () => {
    setIncomingcall(false)
    if (peerConnection.current) {
      peerConnection.current.close()
      peerConnection.current = null
    }
    setPendingOffer(null)
    socket.current.emit('call_reject', ({ targetUser: pendingOffer.caller.id, callee: socket.current.id }))
  }
  
  const handleEnd = () => {
    socket.current.emit('call_ended', { target: currentUser.partner, currentUser: currentUser.id })
    console.log("you are ending the call")
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    setTarget(null)
    setCallEnded(true)
    setInCall(false);
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
            <button className='muteBtn' onClick={handleVideo}>{pause ? 'Play' : 'Pause'}</button>
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
    
      {/* All your popups with improved structure */}
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