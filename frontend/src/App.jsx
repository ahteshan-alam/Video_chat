import {Routes,Route} from 'react-router-dom'
import './App.css'
import Home from './home/home' 
import Join from './join/join'


function App() {
 

  return (
    <>
     <Routes>
      <Route path="/" element={<Join/>}/>
      <Route path='/home' element={<Home/>}/>
     </Routes>
    </>
  )
}


export default App
