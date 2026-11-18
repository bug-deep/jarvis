const mode = process.argv[2] || 'app';

if (mode === 'cloud') {
  const { startCloud } = await import('./cloud/main.js');
  await startCloud();
} else if (mode === 'app') {
  const { startApp } = await import('./app/main.js');
  await startApp();
} else {
  console.error('Использование: node src/main.js cloud|app');
  process.exit(1);
}
