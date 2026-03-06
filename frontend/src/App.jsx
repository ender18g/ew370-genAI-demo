import { NavLink, Route, Routes } from 'react-router-dom';
import TokenizationPage from './pages/TokenizationPage';
import ContinuationPage from './pages/ContinuationPage';
import AttentionPage from './pages/AttentionPage';
import InstructorPage from './pages/InstructorPage';
import StudentPage from './pages/StudentPage';

function Navigation() {
  return (
    <header className="header">
      <h1>USNA EW370 Gen AI Demo</h1>
      <nav>
        <NavLink to="/">Tokenization</NavLink>
        <NavLink to="/continuation">Continuation</NavLink>
        <NavLink to="/attention">Attention</NavLink>
        <NavLink to="/class/instructor">Classroom</NavLink>
      </nav>
    </header>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <Navigation />
      <main className="content">
        <Routes>
          <Route path="/" element={<TokenizationPage />} />
          <Route path="/continuation" element={<ContinuationPage />} />
          <Route path="/attention" element={<AttentionPage />} />
          <Route path="/class/instructor" element={<InstructorPage />} />
          <Route path="/class/join/:sessionId" element={<StudentPage />} />
        </Routes>
      </main>
    </div>
  );
}
