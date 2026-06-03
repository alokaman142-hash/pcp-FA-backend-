# Issue Tracker Backend

This repository contains the Node.js backend for the issue tracker.

## Setup

1. Install dependencies:
   ```powershell
   npm install
   ```
2. Create a `.env` file from `.env.example`:
   ```powershell
   copy .env.example .env
   ```
3. Set your MongoDB Atlas URI and JWT secret in `.env`.
   Example connection string:
   ```text
   MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/issue-tracker?retryWrites=true&w=majority
   JWT_SECRET=your_super_secret_key
   ```
4. Start the server:
   ```powershell
   npm start
   ```

## Deployment

- Render can use `render.yaml` to deploy this backend service.
- Ensure `MONGO_URI` and `JWT_SECRET` are set as environment variables.
