const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const db = require('../db');

// Configure passport local strategy
passport.use(new LocalStrategy(
  function(username, password, done) {
    const user = db.getUserByUsername(username);
    
    if (!user) {
      return done(null, false, { message: 'Invalid username or password' });
    }
    
    if (!user.is_active) {
      return done(null, false, { message: 'Account is disabled' });
    }
    
    if (!db.validatePassword(user, password)) {
      return done(null, false, { message: 'Invalid username or password' });
    }
    
    // Update last login
    db.updateLastLogin(user.id);
    
    return done(null, user);
  }
));

// Serialize user for session
passport.serializeUser(function(user, done) {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(function(id, done) {
  const user = db.getUserById(id);
  if (user) {
    // Don't include password hash in session
    delete user.password_hash;
    done(null, user);
  } else {
    done(null, false);
  }
});

// Middleware to check if user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  // Store the original URL to redirect after login
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
}

// Middleware to check if user has specific role
function ensureRole(...roles) {
  return function(req, res, next) {
    if (!req.isAuthenticated()) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/auth/login');
    }
    
    if (roles.includes(req.user.role)) {
      return next();
    }
    
    res.status(403).render('cad/error', {
      pageTitle: 'Access Denied',
      message: 'You do not have permission to access this page'
    });
  };
}

// Middleware to check if user can edit (admin or operator)
function ensureCanEdit(req, res, next) {
  return ensureRole('admin', 'operator')(req, res, next);
}

// Middleware to check if user is admin
function ensureAdmin(req, res, next) {
  return ensureRole('admin')(req, res, next);
}

module.exports = {
  passport,
  ensureAuthenticated,
  ensureRole,
  ensureCanEdit,
  ensureAdmin
};
