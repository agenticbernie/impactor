// Build-time entry only. The same RuntimeApp also powers Studio and source export.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RuntimeApp } from '../../components/runtime/RuntimeApp';
import { parseProjectJson } from '../schema';
import '../../components/runtime/runtime.css';

const root = document.getElementById('app');
const data = document.getElementById('project-data');
if (!root || !data) throw new Error('Missing static application data');
const result = parseProjectJson(data.textContent || '');
if (!result.success || result.project.network.chainId !== 43113) {
  root.textContent = 'Invalid or unsupported project. This application supports Avalanche Fuji only.';
} else {
  document.title = result.project.name;
  createRoot(root).render(<RuntimeApp project={result.project} />);
}
