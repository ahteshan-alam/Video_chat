import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import "./chat.css";
import Message from "../message/message";
import ScrollToBottom from "react-scroll-to-bottom";
import io from "socket.io-client";

function Chat() {
  const location = useLocation();
  const username = location.state?.username;
  const room = location.state?.room;

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [showOnlineUsers, setShowOnlineUsers] = useState(false);
  const [currUserId, setCurrUserId] = useState("");
  const [typeMsg, setTypeMsg] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const socket = useRef(null);
  const typingTimeout = useRef(null);

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

  useEffect(() => {
    socket.current = io("https://chatterboxx-rz5g.onrender.com/");

    socket.current.on("connect", () => {
      setCurrUserId(socket.current.id);
      socket.current.emit("join-room", { username, room });

    
    });

    socket.current.on("user-joined", ({ type, message, id, clients }) => {
      setOnlineUsers(clients);
      setMessages((prev) => [...prev, { message, type, id }]);
    });

    socket.current.on("welcome", ({ message, type, id, clients }) => {
      setOnlineUsers(clients);
      
      setMessages((prev) => [...prev, { message, type, id }]);

      setIsLoading(false);
      

    });

    socket.current.on("send-message", ({ message, username, type, id, time, userId }) => {
      setMessages((prev) => [
        ...prev,
        { message, username, type, id, time, userId }
      ]);
    });

    socket.current.on("user-left", ({ message, type, id, clients }) => {
      setOnlineUsers(clients);
      setMessages((prev) => [...prev, { message, type, id }]);
    });

    socket.current.on("user-typing", ({ message }) => {
      setTypeMsg(message);
    });

    return () => {
      if (typingTimeout.current) {
        clearTimeout(typingTimeout.current);
      }

      if (socket.current) {
        socket.current.disconnect();
        socket.current.off();
      }
    };
  }, [username, room]);


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
      <div className="header">
        <h1>ChatterBox</h1>
        <div className="online-section">
          <button className="online-count-btn" onClick={toggleOnlineUsers}>
            <span className="online-indicator">●</span>
            <span>{onlineUsers.length} online</span>
          </button>

          {showOnlineUsers && (
            <div className="online-dropdown">
              <div className="dropdown-header">
                Online Users ({onlineUsers.length})
              </div>
              <div className="online-users-list">
                {onlineUsers.map((client) => (
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
    </div>
  );
}

export default Chat;