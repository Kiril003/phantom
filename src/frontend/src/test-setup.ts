import '@testing-library/jest-dom';

// Mock HTMLCanvasElement.getContext for jsdom (Avatar uses canvas)
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
