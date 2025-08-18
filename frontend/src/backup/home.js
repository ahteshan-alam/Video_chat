import { useEffect, useRef, useState } from 'react';
import { useLocation,useNavigate } from 'react-router-dom';
import './home.css'

import { io } from 'socket.io-client'
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function Home() {
  let [otherusers, setOtherusers] = useState([])
  let [currentUser, setCurrentUser] = useState({})
  let [incomingcall, setIncomingcall] = useState(false)
  let [userBusy,setUserBusy]=useState(false)
  let [answer, setAnswer] = useState()
  const location = useLocation()
  const formData = location.state?.formData
  const localVideo = useRef()
  const localStream = useRef()
  const remoteVideo = useRef()
  const socket = useRef()
  const peerConnection = useRef()
  const navigate = useNavigate()
  useEffect(() => {
    if(!formData){
      navigate("/")
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localVideo.current.srcObject = stream
        localStream.current = stream
        socket.current = io("http://localhost:2000/")
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

        socket.current.on('offer', (payload) => {
          console.log(`offer recieved from ${payload.caller} to ${payload.target}`)
          if (payload.sdp) {
            setIncomingcall(true)
          }
          setAnswer(payload)
        })
        socket.current.on('userBusy',({message})=>{
              setUserBusy(true)
              console.log(message)
        })
        socket.current.on('answer', (payload) => {
          peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp))
        })
        socket.current.on('ice-candidate', (payload) => {
          if (peerConnection.current) {
            peerConnection.current.addIceCandidate(new RTCIceCandidate(payload.route))
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
  const createOffer = async ({ targetUser,user }) => {
   
      console.log("sending offer to ", targetUser)
      peerConnection.current = new RTCPeerConnection(configuration)
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          socket.current.emit('ice-candidate', { target: targetUser, route: event.candidate })
        }
      }
      peerConnection.current.ontrack = (event) => {
        remoteVideo.current.srcObject = event.streams[0]
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
    peerConnection.current = new RTCPeerConnection(configuration)
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.current.emit('ice-candidate', { target: payload.caller.id, route: event.candidate })
      }
    }
    peerConnection.current.ontrack = (event) => {
      remoteVideo.current.srcObject = event.streams[0]
    }
    localStream.current.getTracks().forEach(track => {
      peerConnection.current.addTrack(track, localStream.current)
    })
    await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp))
    const answer = await peerConnection.current.createAnswer()
    await peerConnection.current.setLocalDescription(answer)
    socket.current.emit('answer', { target: payload.caller.id, sdp: answer, caller: currentUser })

  }
  const sendAnswer = (answer) => {

    createAnswer({ payload: answer })
    setIncomingcall(false)

  }




  return (
    <div className='App'>
      <h1>My Video Call App {currentUser.username}</h1>
      <div className='video'>
        <video ref={localVideo} autoPlay muted playsInline></video>
        <video ref={remoteVideo} autoPlay playsInline></video>

      </div>
      {incomingcall && <div id="incomingCallPopup">
        <p>Incoming Call from {answer.caller.username}</p>
        <button onClick={() => sendAnswer(answer)}>Accept</button>
        <button onClick={() => setIncomingcall(false)}>Reject</button>
      </div>
      }
      {userBusy && <div id="incomingCallPopup">
        <p>user busy in another call</p>
      
        <button onClick={() => setUserBusy(false)}>ok</button>
      </div>
      }

      <div className='list'>
        <p>these are the online users</p>
        <ul>
          {otherusers.length > 0 ? otherusers.map(user =>
            (<li key={user.id}>{user.username}<button onClick={() => createOffer({ targetUser: user.id,user:user })}>call</button></li>)
          ) : (<li>no users online</li>)}
        </ul>


      </div>


    </div>
  );
}

export default Home;