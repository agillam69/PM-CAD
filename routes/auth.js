const express = require('express');
const router = express.Router();
const { passport, ensureAuthenticated, ensureAdmin } = require('../middleware/auth');
const db = require('../db');

// Login page
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/cad');
  }
  res.render('auth/login', {
    pageTitle: 'Login - CAD',
    error: req.flash ? req.flash('error') : null,
    layout: false
  });
});

// Login POST
router.post('/login', passport.authenticate('local', {
  failureRedirect: '/auth/login',
  failureFlash: true
}), (req, res) => {
  const returnTo = req.session.returnTo || '/cad';
  delete req.session.returnTo;
  res.redirect(returnTo);
});

// Logout
router.get('/logout', (req, res) => {
  req.logout(function(err) {
    if (err) { console.error(err); }
    res.redirect('/auth/login');
  });
});

// User management (admin only)
router.get('/users', ensureAdmin, (req, res) => {
  const users = db.getAllUsers();
  res.render('auth/users', {
    pageTitle: 'User Management - CAD',
    users,
    currentUser: req.user
  });
});

// Create user (admin only)
router.post('/users', ensureAdmin, (req, res) => {
  const { username, password, displayName, role } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  const result = db.createUser(username, password, displayName || username, role || 'viewer');
  
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// Update user (admin only)
router.put('/users/:id', ensureAdmin, (req, res) => {
  const { id } = req.params;
  const { displayName, role, isActive, password } = req.body;
  
  // Prevent admin from disabling themselves
  if (parseInt(id) === req.user.id && isActive === false) {
    return res.status(400).json({ error: 'Cannot disable your own account' });
  }
  
  const updates = {};
  if (displayName !== undefined) updates.displayName = displayName;
  if (role !== undefined) updates.role = role;
  if (isActive !== undefined) updates.isActive = isActive;
  if (password) updates.password = password;
  
  const result = db.updateUser(parseInt(id), updates);
  res.json(result);
});

// Delete user (admin only)
router.delete('/users/:id', ensureAdmin, (req, res) => {
  const { id } = req.params;
  
  // Prevent admin from deleting themselves
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  
  const result = db.deleteUser(parseInt(id));
  res.json(result);
});

// Change own password
router.post('/change-password', ensureAuthenticated, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  const user = db.getUserById(req.user.id);
  
  if (!db.validatePassword(user, currentPassword)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  
  db.updateUser(req.user.id, { password: newPassword });
  res.json({ success: true });
});

module.exports = router;
