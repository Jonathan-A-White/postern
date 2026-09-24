import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Gate } from './gate';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gate />
  </StrictMode>,
);
