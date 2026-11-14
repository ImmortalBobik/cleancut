/**
 * Sample Image Generator
 * Creates 3 high-quality synthetic 800x800 test images as PNG File objects
 * for Chroma Key and AI Person Removal testing.
 */

function canvasToFile(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const file = new File([blob], filename, { type: 'image/png' });
      resolve(file);
    }, 'image/png');
  });
}

/**
 * Image 1: Green Screen Portrait with Studio Stand
 */
function renderGreenScreenPortrait(ctx, width, height) {
  // Green Screen Background
  ctx.fillStyle = '#00b140';
  ctx.fillRect(0, 0, width, height);

  // Far-right studio lighting stand (disconnected component)
  ctx.fillStyle = '#1e293b';
  // Stand vertical rod
  ctx.fillRect(730, 260, 10, 480);
  // Stand top head/reflector
  ctx.beginPath();
  ctx.ellipse(735, 250, 35, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  // Stand tripod feet
  ctx.beginPath();
  ctx.moveTo(735, 700);
  ctx.lineTo(690, 780);
  ctx.lineTo(780, 780);
  ctx.closePath();
  ctx.fill();

  // Draw Person in Center
  // Body / Jacket
  ctx.fillStyle = '#1e293b'; // Navy/dark charcoal jacket
  ctx.beginPath();
  ctx.moveTo(400, 480);
  ctx.bezierCurveTo(280, 500, 160, 560, 110, 800);
  ctx.lineTo(690, 800);
  ctx.bezierCurveTo(640, 560, 520, 500, 400, 480);
  ctx.closePath();
  ctx.fill();

  // Jacket collar lapels
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(330, 490);
  ctx.lineTo(400, 680);
  ctx.lineTo(470, 490);
  ctx.lineTo(400, 520);
  ctx.closePath();
  ctx.fill();

  // White inner shirt
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.moveTo(360, 490);
  ctx.lineTo(400, 600);
  ctx.lineTo(440, 490);
  ctx.closePath();
  ctx.fill();

  // Neck
  ctx.fillStyle = '#e0ac69';
  ctx.fillRect(365, 420, 70, 90);

  // Head / Face
  ctx.fillStyle = '#f1c27d';
  ctx.beginPath();
  ctx.ellipse(400, 340, 105, 130, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.beginPath();
  ctx.ellipse(290, 350, 16, 26, 0, 0, Math.PI * 2);
  ctx.ellipse(510, 350, 16, 26, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rosy cheeks
  ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
  ctx.beginPath();
  ctx.arc(350, 365, 24, 0, Math.PI * 2);
  ctx.arc(450, 365, 24, 0, Math.PI * 2);
  ctx.fill();

  // Hair
  ctx.fillStyle = '#1c1917';
  ctx.beginPath();
  ctx.arc(400, 290, 120, Math.PI * 0.9, Math.PI * 2.1);
  ctx.bezierCurveTo(480, 240, 420, 210, 380, 210);
  ctx.bezierCurveTo(340, 210, 280, 250, 290, 320);
  ctx.closePath();
  ctx.fill();

  // Glasses frames
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 6;
  // Left lens frame
  ctx.strokeRect(330, 320, 50, 38);
  // Right lens frame
  ctx.strokeRect(420, 320, 50, 38);
  // Bridge
  ctx.beginPath();
  ctx.moveTo(380, 335);
  ctx.lineTo(420, 335);
  ctx.stroke();

  // Eyes inside glasses
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(355, 339, 6, 0, Math.PI * 2);
  ctx.arc(445, 339, 6, 0, Math.PI * 2);
  ctx.fill();

  // Smile
  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(400, 395, 28, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();

  // Subtle green spill rim along jacket shoulders
  ctx.strokeStyle = 'rgba(0, 177, 64, 0.35)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(112, 790);
  ctx.bezierCurveTo(160, 560, 280, 500, 400, 480);
  ctx.bezierCurveTo(520, 500, 640, 560, 688, 790);
  ctx.stroke();
}

/**
 * Image 2: Studio Blue Backdrop Portrait
 */
function renderBlueStudioPortrait(ctx, width, height) {
  // Blue studio radial gradient
  const grad = ctx.createRadialGradient(400, 350, 50, 400, 400, 500);
  grad.addColorStop(0, '#1d4ed8');
  grad.addColorStop(1, '#0047bb');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Person Body (Crimson / Terracotta Blazer)
  ctx.fillStyle = '#991b1b';
  ctx.beginPath();
  ctx.moveTo(400, 490);
  ctx.bezierCurveTo(270, 510, 170, 570, 120, 800);
  ctx.lineTo(680, 800);
  ctx.bezierCurveTo(630, 570, 530, 510, 400, 490);
  ctx.closePath();
  ctx.fill();

  // White turtleneck collar
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.ellipse(400, 475, 55, 22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Neck
  ctx.fillStyle = '#fbcfe8';
  ctx.fillStyle = '#fcd34d';
  ctx.fillStyle = '#e5b887';
  ctx.fillRect(370, 405, 60, 75);

  // Face
  ctx.fillStyle = '#f8d1a2';
  ctx.beginPath();
  ctx.ellipse(400, 330, 95, 120, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.beginPath();
  ctx.ellipse(300, 335, 14, 22, 0, 0, Math.PI * 2);
  ctx.ellipse(500, 335, 14, 22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Curly wavy hair
  ctx.fillStyle = '#451a03';
  ctx.beginPath();
  ctx.arc(400, 270, 125, Math.PI * 0.85, Math.PI * 2.15);
  ctx.bezierCurveTo(520, 230, 450, 190, 400, 190);
  ctx.bezierCurveTo(350, 190, 270, 230, 285, 310);
  ctx.closePath();
  ctx.fill();

  // Eyebrows
  ctx.strokeStyle = '#451a03';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(335, 305);
  ctx.lineTo(375, 308);
  ctx.moveTo(425, 308);
  ctx.lineTo(465, 305);
  ctx.stroke();

  // Eyes
  ctx.fillStyle = '#1e1b4b';
  ctx.beginPath();
  ctx.arc(355, 325, 7, 0, Math.PI * 2);
  ctx.arc(445, 325, 7, 0, Math.PI * 2);
  ctx.fill();

  // Gentle smile
  ctx.strokeStyle = '#9a3412';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(400, 380, 25, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

/**
 * Image 3: Outdoor Park Scene with Main Person
 */
function renderOutdoorParkPerson(ctx, width, height) {
  // Sky Gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, 450);
  skyGrad.addColorStop(0, '#38bdf8');
  skyGrad.addColorStop(0.7, '#bae6fd');
  skyGrad.addColorStop(1, '#fef08a');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, 450);

  // Warm Sun
  ctx.fillStyle = 'rgba(253, 224, 71, 0.8)';
  ctx.beginPath();
  ctx.arc(140, 120, 45, 0, Math.PI * 2);
  ctx.fill();

  // Distant Trees & Foliage
  ctx.fillStyle = '#166534';
  ctx.beginPath();
  ctx.arc(100, 420, 90, 0, Math.PI * 2);
  ctx.arc(220, 400, 110, 0, Math.PI * 2);
  ctx.arc(680, 410, 120, 0, Math.PI * 2);
  ctx.arc(760, 430, 90, 0, Math.PI * 2);
  ctx.fill();

  // Lush Green Grass
  const grassGrad = ctx.createLinearGradient(0, 430, 0, height);
  grassGrad.addColorStop(0, '#4ade80');
  grassGrad.addColorStop(1, '#15803d');
  ctx.fillStyle = grassGrad;
  ctx.fillRect(0, 430, width, height - 430);

  // Distant park bench on right
  ctx.fillStyle = '#78350f'; // wood planks
  ctx.fillRect(620, 510, 130, 14);
  ctx.fillRect(620, 532, 130, 12);
  ctx.fillStyle = '#334155'; // legs
  ctx.fillRect(635, 544, 8, 45);
  ctx.fillRect(725, 544, 8, 45);

  // Main Person Standing in Center
  // Denim Blue Jeans
  ctx.fillStyle = '#1e3a8a';
  // Left leg
  ctx.fillRect(360, 580, 36, 170);
  // Right leg
  ctx.fillRect(404, 580, 36, 170);

  // White sneakers
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.ellipse(375, 755, 26, 14, 0, 0, Math.PI * 2);
  ctx.ellipse(425, 755, 26, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Emerald / Teal Hoodie
  ctx.fillStyle = '#0f766e';
  ctx.beginPath();
  ctx.moveTo(400, 360);
  ctx.bezierCurveTo(320, 375, 300, 415, 290, 590);
  ctx.lineTo(510, 590);
  ctx.bezierCurveTo(500, 415, 480, 375, 400, 360);
  ctx.closePath();
  ctx.fill();

  // Neck
  ctx.fillStyle = '#f5cba7';
  ctx.fillRect(380, 305, 40, 60);

  // Head
  ctx.beginPath();
  ctx.ellipse(400, 265, 65, 80, 0, 0, Math.PI * 2);
  ctx.fill();

  // Curly Hair
  ctx.fillStyle = '#292524';
  ctx.beginPath();
  ctx.arc(400, 230, 80, Math.PI * 0.8, Math.PI * 2.2);
  ctx.bezierCurveTo(470, 185, 420, 175, 400, 175);
  ctx.bezierCurveTo(380, 175, 330, 185, 325, 250);
  ctx.closePath();
  ctx.fill();

  // Eyes & Smile
  ctx.fillStyle = '#1c1917';
  ctx.beginPath();
  ctx.arc(378, 262, 5, 0, Math.PI * 2);
  ctx.arc(422, 262, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#c2410c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(400, 295, 18, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

/**
 * Generate 3 crisp 800x800 test PNG File objects
 */
export async function createSampleImages() {
  const width = 800;
  const height = 800;

  // 1. Green screen
  const c1 = document.createElement('canvas');
  c1.width = width;
  c1.height = height;
  renderGreenScreenPortrait(c1.getContext('2d'), width, height);
  const file1 = await canvasToFile(c1, 'friend-green-screen.png');

  // 2. Blue studio
  const c2 = document.createElement('canvas');
  c2.width = width;
  c2.height = height;
  renderBlueStudioPortrait(c2.getContext('2d'), width, height);
  const file2 = await canvasToFile(c2, 'portrait-blue-studio.png');

  // 3. Outdoor park scene
  const c3 = document.createElement('canvas');
  c3.width = width;
  c3.height = height;
  renderOutdoorParkPerson(c3.getContext('2d'), width, height);
  const file3 = await canvasToFile(c3, 'outdoor-park-person.png');

  return [file1, file2, file3];
}
