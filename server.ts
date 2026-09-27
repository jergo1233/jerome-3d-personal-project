import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Ensure uploads directory exists
  const uploadDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Configure multer storage
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
      cb(null, `${baseName}-${uniqueSuffix}${ext}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit for 3D models
    fileFilter: (req, file, cb) => {
      const allowedExtensions = ['.fbx', '.obj', '.gltf', '.glb', '.bin', '.mtl'];
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowedExtensions.includes(ext) || file.mimetype.includes('model') || file.mimetype.includes('octet-stream')) {
        cb(null, true);
      } else {
        cb(new Error('Only 3D model files (.fbx, .obj, .gltf, .glb) are allowed!'));
      }
    }
  });

  app.use(express.json());
  app.use('/uploads', express.static(uploadDir));

  // API to list uploaded models
  app.get('/api/models', (req, res) => {
    try {
      const files = fs.readdirSync(uploadDir);
      const models = files
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return ['.fbx', '.obj', '.gltf', '.glb'].includes(ext);
        })
        .map(file => {
          const filePath = path.join(uploadDir, file);
          const stats = fs.statSync(filePath);
          return {
            id: file,
            name: file.replace(/-\d+([a-zA-Z0-9_-]+)?\.[^.]+$/, '').replace(/_/g, ' '),
            filename: file,
            size: stats.size,
            createdAt: stats.birthtime,
            url: `/uploads/${file}`,
            format: path.extname(file).substring(1).toUpperCase()
          };
        });
      res.json(models);
    } catch (error) {
      console.error('Error reading uploads:', error);
      res.status(500).json({ error: 'Failed to list models' });
    }
  });

  // API to upload model
  app.post('/api/upload', upload.single('modelFile'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      const file = req.file;
      const fileInfo = {
        id: file.filename,
        name: file.originalname.replace(/\.[^/.]+$/, ''),
        filename: file.filename,
        size: file.size,
        createdAt: new Date(),
        url: `/uploads/${file.filename}`,
        format: path.extname(file.originalname).substring(1).toUpperCase()
      };
      res.json({ success: true, model: fileInfo });
    } catch (error: any) {
      console.error('Upload error:', error);
      res.status(500).json({ error: error.message || 'File upload failed' });
    }
  });

  // API to delete model
  app.delete('/api/models/:filename', (req, res) => {
    try {
      const filename = req.params.filename;
      const safeFilename = path.basename(filename);
      const filePath = path.join(uploadDir, safeFilename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Model not found' });
      }
    } catch (error) {
      console.error('Delete error:', error);
      res.status(500).json({ error: 'Failed to delete model' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
