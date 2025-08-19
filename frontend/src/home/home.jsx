import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "./home.css";

function Home() {
  const socket = useRef(null);
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const peerConnection = useRef(null);
  const localStream = useRef(null);

  const [calling, setCalling] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [pause, setPause] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  const { id, user } = location.state || {};

  // ✅ Final ICE Config (Google STUN + Xirsys STUN/TURN)
  const configuration = {
    iceServers: [
      {
        urls: [
          "stun:stun.l.google.com:19302",
          "stun:global.xirsys.net",
        ],
      },
      {
        urls: [
          "turn:global.xirsys.net:3478?transport=udp",
          "turn:global.xirsys.net:3478?transport=tcp",
          "turns:global.xirsys.net:5349?transport=tcp",
        ],
        username: "ahteshan",
        credential: "061c8212-7c6c-11f0-9de2-0242ac140002",
      },
    ],
  };

  // ✅ Setup socket + listeners
  useEffect(() => {
    socket.current = io("https://videochater-backend.onrender.com");

    socket.current.on("call-made", async (data) => {
      await createPeerConnection();
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);
      socket.current.emit("make-answer", { answer, to: data.socket });

      setInCall(true);
    });

    socket.current.on("answer-made", async (data) => {
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      setInCall(true);
    });

    socket.current.on("ice-candidate", async (data) => {
      if (peerConnection.current) {
        try {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error("Error adding ICE candidate", err);
        }
      }
    });

    socket.current.on("call_cancel", () => {
      endCall();
      alert("Call was canceled.");
    });

    // ✅ Cleanup
    return () => {
      if (socket.current) {
        socket.current.disconnect();
        socket.current.off();
      }
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }
    };
  }, []);

  // ✅ PeerConnection setup
  const createPeerConnection = async () => {
    peerConnection.current = new RTCPeerConnection(configuration);

    // Local → Remote
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.current.emit("ice-candidate", { candidate: event.candidate, to: id });
      }
    };

    // Remote stream
    peerConnection.current.ontrack = (event) => {
      if (remoteVideo.current) {
        remoteVideo.current.srcObject = event.streams[0];
        const playPromise = remoteVideo.current.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => console.warn("Autoplay blocked:", err));
        }
      }
    };

    // Get camera/mic
    localStream.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.current.srcObject = localStream.current;
    localStream.current.getTracks().forEach((track) =>
      peerConnection.current.addTrack(track, localStream.current)
    );
  };

  // ✅ Start call
  const callUser = async () => {
    await createPeerConnection();
    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);

    socket.current.emit("call-user", { offer, to: id });
    setCalling(true);
  };

  // ✅ End call
  const endCall = () => {
    setInCall(false);
    setCalling(false);

    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    if (localStream.current) {
      localStream.current.getTracks().forEach((t) => t.stop());
      localStream.current = null;
    }

    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    if (localVideo.current) localVideo.current.srcObject = null;

    socket.current.emit("call_cancel", { target: id, caller: socket.current.id });
  };

  // ✅ Pause/Resume video (stop/start)
  const pauseCall = () => {
    if (pause) {
      navigator.mediaDevices.getUserMedia({ video: true }).then((newStream) => {
        const newTrack = newStream.getVideoTracks()[0];
        const sender = peerConnection.current.getSenders().find((s) => s.track.kind === "video");
        sender.replaceTrack(newTrack);

        localStream.current.addTrack(newTrack);
        localVideo.current.srcObject = localStream.current;
      });
      setPause(false);
    } else {
      localStream.current.getVideoTracks().forEach((t) => t.stop());
      setPause(true);
    }
  };

  return (
    <main className="main-content">
      <section className="video-section">
        <div className="video">
          <div className="local-video-container">
            <video ref={localVideo} autoPlay muted playsInline></video>
            <div className="video-label">You</div>
          </div>
          <div className="remote-video-container">
            <video ref={remoteVideo} autoPlay playsInline></video>
            <div className="video-label">Remote</div>
          </div>
        </div>
      </section>

      <section className="controls">
        {!inCall && !calling && <button onClick={callUser}>📞 Call</button>}
        {calling && <p>Calling...</p>}
        {inCall && (
          <>
            <button onClick={pauseCall}>{pause ? "▶ Resume Video" : "⏸ Pause Video"}</button>
            <button onClick={endCall}>❌ End Call</button>
          </>
        )}
      </section>
    </main>
  );
}

export default Home;
