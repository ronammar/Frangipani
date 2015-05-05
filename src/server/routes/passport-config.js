/* Configuration for the passport express app.
 * This module configures the various associated routes and actions
 * for the passport app. It adds functions for de/serializing users,
 * adding new users, loggin in, and logging out.
 * @author Patrick Magee
 */
var LocalStrategy = require('passport-local').Strategy;
var GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
var dbConstants = require('../lib/conf/constants.json').dbConstants;


module.exports = function(passport,dbFunctions,opts){
	if (!dbFunctions)
		dbFunctions = require('../models/mongodb_functions');


	/* Method to serialize new user */
	passport.serializeUser(function(user,done){
		done(null,user[dbConstants.USERS.ID_FIELD]);
	});
	/* Method to deserialize new user */
	passport.deserializeUser(function(id,done){
		dbFunctions.findUserById(id).then(function(user){
			done(null,user);
		}).catch(function(err){
			done(err);
		});
	});

	//If the server was started with the option to signum, run this route
	if (opts.signup){
		/* attache the local signup method to the passport instance */
		passport.use('local-signup', new LocalStrategy({
			usernameField:dbConstants.USERS.ID_FIELD,
			passwordField:dbConstants.USERS.PASSWORD_FIELD,
			passReqToCallback: true
		},
			//Adds a new user to the usre database is if there is  not already one that exists
			function(req,username,password,done){
				process.nextTick(function(){
					dbFunctions.findUserById(username)
					.then(function(user){
						if (user) {
							return done(null,false,req.flash('error','That Email already exists'),req.flash('statusCode','409'));
						} else {
							user = {};
							user[dbConstants.USERS.ID_FIELD] = username.toString();
							user[dbConstants.USERS.PASSWORD_FIELD] = password.toString();
							dbFunctions.addUser(user).then(function(){
								return done(null,user,req.flash('statusCode','200'),req.flash('alert',true),req.flash('message','Account successfully created'));
							}).catch(function(err){
								return done(err,null,req.flash('statusCode','400'));
							});
						}
					});
				});
			}
		));
	}
	/* Sign on using the local database */
	passport.use('local-login', new LocalStrategy({
		usernameField:dbConstants.USERS.ID_FIELD,
		passwordField:dbConstants.USERS.PASSWORD_FIELD,
		passReqToCallback:true
	},

		function(req,username,password,done){
			process.nextTick(function(){
				dbFunctions.findUserById(username)
				.then(function(user){
					if (user) { 
						dbFunctions.validatePassword(username.toString(),password.toString()).then(function(result){
							if (result){
								return done(null,user,req.flash("statusCode",'200'));
							} else {
								return done(null,false,req.flash("error", "Oops! Wrong Password"),req.flash('statusCode','400'));
							}
						}).catch(function(err){
							done(err);
						});
					} else {
						return done(null,false,req.flash('error','Oops, No user was found!'),req.flash('statusCode','404'));
					}
				});
			});
		}
	));

	/* If oauth has been set up then use google's oath strategy */
	if (opts.oauth){
		var api = require('../lib/conf/api');
		if (!api.googleAuth.clientID){
			console.log("--oauth option passed however Oauth is not set up! please setup the lib/conf/api.js googleOAUTH and then try again");
			process.exit(1);
		}
		passport.use(new GoogleStrategy({
			clientID: api.googleAuth.clientID,
			clientSecret: api.googleAuth.clientSecret,
			callbackURL:api.googleAuth.callbackURL
		},	
			function(token,refreshToken,profile,done){
				process.nextTick(function(){
					var query = {};
					query[dbConstants.USERS.GOOGLE.ID_FIELD] = profile.id;
					dbFunctions.findUserByGoogleId(profile.id)
					.then(function(user){
						if (user) {
							return done(null,user);
						} else {
							user = {};
							user[dbConstants.USERS.ID_FIELD]= profile.emails[0].value;
							user[dbConstants.USERS.GOOGLE.ID_FIELD]=profile.id;
							user[dbConstants.USERS.GOOGLE.TOKEN_FIELD]=token;
							user[dbConstants.USERS.GOOGLE.NAME_FIELD]=profile.displayName;
							user[dbConstants.USERS.GOOGLE.EMAIL_FIELD]=profile.emails[0].value;
							dbFunctions.addUserGoogle(user).then(function(){
								return done(null,user);
							}).catch(function(err){
								done(err);
							});
						}
					});
				});
			}
		));
	}
};