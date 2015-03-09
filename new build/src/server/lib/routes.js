var nodemailer = require('nodemailer');
var constants = require("./lib/constants.json");
var uploader= require("jquery-file-upload-middleware");
var Queue = require('./queue');
var Promise= require("bluebird");
var pgx = require('./pgx/pgx_haplotypes');

var render = function(req,res,scripts){
	if (req.isAuthenticated()){
		var _o = {
			title:'PGX webapp',
			'authenticated':true,
			'user':req.user.username,
			'cache':true
		}
		if (scripts){
			_o['scripts'] = scripts;

		res.render('layout',_o);
	} else {
		res.render('layout');
	}
}

var nodeConstant = constants.nodeConstants,
	dbConstants = constants.dbConstants;

module.exports = function(app,passport,dbFunctions,opts,logger){
	
	//==================================================================
	//initialize the queing system for incoming file uploads
	//==================================================================
	var queue = new Queue(logger,dbFunctions);

	//==================================================================
	//initialize the transporter for sending mail via gmail
	//==================================================================
	if (opts.gmail && opts.password){
		logger.info('Email provided for user communication, setting up mailer');
		var transporter = nodemailer.createTransport({
			service:'gmail',
			auth:{
				user: opts.gmail, // this must be set up a new each time.
				pass: opts.password
			}
		});
	}

	//==================================================================
	//LOGIN Request
	//==================================================================
	app.get('/login',function(req,res){
		if(req.isAuthenticated())
			res.redirect('/');
		else 
			render(req,res)
	})
	//urlencodedParser
	app.post('/login',passport.authenticate('local-login',{
		successRedirect:'/success',
		failureRedirect:'/failure',
		failureFlash:true
	}));
		


	//==================================================================
	//Check which Auth is set and send object back
	//==================================================================
	app.get('/auth/check',function(req,res){
		var data = {
			signup:opts.signup,
			recover:opts.recover,
			oauth:opts.oauth,
			login:true
		}
		res.send(data);
	})


	app.get('/auth/user',function(req,res){
		var data ={}
		if (req.user)
			data.user = req.user[dbConstants.USER_ID_FIELD]
		else
			data.user = undefined
		res.send(data);
	})

	//==================================================================
	//SIGNUP Request if flag true
	//==================================================================
	if (opts.signup){
		logger.info('Using account signup');
		app.get('/signup',function(req,res){
			if (req.isAuthenticated())
				res.redirect('/');
			else
				render(req,res);
		});
		//urlencodedParser
		//parse signup information
		app.post('/signup',passport.authenticate('local-signup',{
			successRedirect:'/success',
			failureRedirect:'/failure',
			failureFlash:true
		}));

	}
	
	//===============================================================
	// Add recover Password if Flag true
	//==================================================================
	if (opts.recover) {	
		logger.info('Using account recovery');
		app.get('/recover', function(req,res){
			if (req.isAuthenticated())
				res.redirect('/');
			res.render(req,res);
		});

		app.post('/recover',function(req,res){
			var body = req.body;
			//check if user is valid
			dbFunctions.findUserById(body.username)
			.then(function(user){
				if (user) {
					if (user[dbConstants.USER_GOOGLE_ID_FIELD]){
						req.flash('error','Oops that username appears to be linked to a Google account. Please sign in to Google to change your password');
						req.flash('statusCode','400');
						res.redirect('/failure');
					} else {
						dbFunctions.generatePassword(body.username)
						.then(function(result){
							var mailOptions = {
								from:'patrickmageee@gmail.com',
								to:body.username,
								subject:'password reset',
								html:'<h4>Password Reset<h4>'
								+ '<p>Your temporary password is:  ' + result + "</p>"
								+ '<p>Please login and change your password</p><br>'
								+ '<p><b>Do not reply to this email</b></p>'
							}
							transporter.sendMail(mailOptions,function(err,info){
								if (err){
									console.log(err);
								}else {
									req.flash('statusCode','200');
									res.redirect('/success');
								}
							});
						});
					}

				} else {
					req.flash('error','Oops, No user was found!');
					req.flash('statusCode','404');
					res.redirect('/failure')
				}
			})

		})
	}

	app.get('/setpassword',isLoggedIn, function(req,res){
		render(req,res);
	})

	app.post('/setpassword',function(req,res){
		var data = req.body;
		var username = req.user.username.toString();
		if (req.user.hasOwnProperty(dbConstants.USER_GOOGLE_ID_FIELD)){
			req.flash('error','Oops, You appear to be signed in with a Google account, you must log into google to change your password!');
			req.flash('statusCode','400');
			res.redirect('/failure');
		} else {
			dbFunctions.findUserById(username).then(function(user){
				if (user){
					dbFunctions.validatePassword(username,data['password'].toString()).then(function(result){
						if (result){
							dbFunctions.changePassword(username, data['newpassword'].toString()).then(function(){
								req.flash('statusCode','200');
								res.redirect('/success');
							})
						} else {
							req.flash('error','Oops incorrect password!');
							req.flash('statusCode','400');
							res.redirect('/failure');
						}
					});
				} else {
					req.flash('error','Oops User not found');
					req.redirect('/failure');
				}
			})
		}
	})

	//route to send information in the event of a login failure
	app.get('/failure',function(req,res){
		var response ={status:'failed',error:req.flash('error'),redirectURL:undefined,statusCode:req.flash('statusCode')}
		res.send(JSON.stringify(response))
	});

	//route to send information in the event of a login success
	app.get('/success',function(req,res){
		var redirectURL = req.flash('redirectURL');
		var response = {status:'ok',error:undefined,redirectURL:(redirectURL != '' ? redirectURL:'/'),statusCode:req.flash('statusCode')}
		res.send(JSON.stringify(response))
	})
	//==================================================================
	//LOGIN WITH GOOGLE Request if flag set true
	//==================================================================
	if (opts.oauth){
		logger.info('Using Google OAUTH authentication');
		app.get('/auth/google', passport.authenticate('google', { scope : ['profile', 'email'] }));

	//==================================================================
	//RESPONSE FROM GOOGLE Request
	//==================================================================
	    app.get('/auth/google/callback',
	        passport.authenticate('google', {
	            successRedirect : '/',
	            failureRedirect : '/login'
	       	})
	    );
	}

	//==================================================================
	//Logout
	//==================================================================
	app.get('/logout', function(req,res){
		req.logout()
		res.redirect('/')
	})


	//==================================================================
	//Route to the home page, or the config page if it is not set
	//==================================================================
	var configured = undefined;
	app.get("/", isLoggedIn, function(req, res) {
		/* Check if the server has already been configured. 
		 * Using a bit of promise voodoo to ensure we check the DB first, but only
		* when configured !== true, so as to reduce DB interactions. */	
		var promise= new Promise.resolve(configured);
		if (!configured) {
			promise= dbFunctions.isConfigured();
		}

		/* If server is not configured redirect to the config page. Use a boolean
		 * instead of checking the DB with each request. */
		promise.then(function(resolved_config) {
			if (resolved_config) {
				if (!configured) {
					configured= resolved_config;
				}
				render(req,res);
			} else {
				res.redirect('/config');
			}
		});
	});


	//==================================================================
	//config form
	//==================================================================
	app.post("/config", isLoggedIn, function(req,res){
		var promise = new Promise.resolve(configured);
		if (! configured) {
			promise = dbFunctions.isConfigured();
		}
		promise.then(function(resolved_config){
			if (resolved_config){
				if(!configured)
					configured = resolved_config;
				res.redirect('/');
			} else {
				render(req,res);
			}
		});
	});

	app.post("/config", isLoggedIn, function(req,res){
		var configSettings= req.body;
		dbFunctions.update(dbConstants.ADMIN_COLLECTION_ID, {}, {$set: configSettings})
		.then(function(result){
			dbFunctions.isConfigured(true);
		}).then(function(result){
			res.send(JSON.stringify(true));
		});
	});

	//==================================================================
	//Generic page routers
	//==================================================================

	//Upload page routes
	app.get('/upload',isLoggedIn, function(req,res){
		render(req,res);
	});

	//new projects
	app.get('/projects', isLoggedIn, function(req,res){
		render(req,res);
	})
	//statusPage routes
	app.get('/statuspage',isLoggedIn,function(req,res){
		render(req,res);
	})

	//browse all patients and serve patient page
	app.get('/browsepatients',isLoggedIn,function(req,res){
		render(req,res);
	})






	//==================================================================
	//check to see whether or not the user is authenticated yet
	//==================================================================	
	app.get('/authenticated', function(req,res){
		if (req.isAuthenticated()){
			res.send(JSON.stringify(true));
		} else {
			res.send(JSON.stringify(undefined));
		}
	});







	//==================================================================
	//Database find routes
	//==================================================================

	app.use("/database/getPatients", isLoggedIn, function(req,res){
		var username = req.user[dbConstants.USER_ID_FIELD];
		dbFunctions.findAllPatientIds(username)
		.then(function(result){
			var fieldsArray = []
			queue.queue.map(function(item){
				fieldsArray = fieldsArray.concat(item['fields']);
			});
			return result.concat(fieldsArray);
		}).then(function(result){
			res.send(result);
		});
	});


	/* Find ALL patients including those in the queue */
	app.use('/database/find',isLoggedIn, function(req,res){
		var username = req.user[dbConstants.USER_ID_FIELD];
		dbFunctions.findAllPatients(undefined, undefined, {sort:{'completed':-1}}, username)
		.then(function(result){
			var fieldsArray = [];
			for (var i=queue.queue.length-1; i>= 0; i--){
				for ( var j=0; j < queue.queue[i]['fields'].length; j++){
					if (queue.queue[i]['fields'][j]['owner'] == username)
						fieldsArray.push(queue.queue[i]['fields'][j])
				}
			}
			return fieldsArray.concat(result);
		}).then(function(result){
			res.send(result.sort(function(a,b){
				a = a.added.split(/\s/)
				b = b.added.split(/\s/)
				if (a[0] < b[0]){
					return 1;
				} else if (a[0] > b[0]) {
					return -1;
				} else {
					if (a[1] < b[1])
						return 1;
					else if (a[1] > b[1])
						return -1;
					return 0;
				}
			}));
		});
	});


	/* retrieve ALl projects for a given user */
	app.get('/database/projects',isLoggedIn, function(req,res){
		var username = req.user[dbConstants.USER_ID_FIELD];

		dbFunctions.findProjects(undefined,username)
		.then(function(result){
			res.send(result);
		});
	})

	/* find information on a specific project */
	app.post('/database/projects',isLoggedIn,function(req,res){
		var username = req.user[dbConstants.USER_ID_FIELD];
		var project = undefined;
		if (req.body){
			project = req.body['project_id'];
		}

		dbFunctions.findProjects(project,username)
		.then(function(result){
			res.send(result);
		});
	})

	/* remove patients froma  project */
	app.post('/database/projects/removepatients',isLoggedIn,function(req,res){
		var project = req.body.project;
		var patients = req.body.patients
		dbFunctions.removePatientsFromProject(project,patients)
		.then(function(success){
			if (success){
				req.flash('statusCode','200');
				res.redirect('/success');
			}
		}).catch(function(err){
			console.log(err);
			req.flash('error',err);
			res.redirect('/failure');
		});
	})

	/* add patients to a project
	*/

	app.post('/database/projects/addpatients',isLoggedIn,function(req,res){
		var project = req.body.project;
		var patients = req.body.patients
		dbFunctions.addPatientsToProject(project,patients)
		.then(function(success){
			if (success){
				req.flash('statusCode','200');
				res.redirect('/success');
			}
		}).catch(function(err){
			console.log(err);
			req.flash('error',err);
			res.redirect('/failure');
		});
	})


	/* add a project
	 */
	app.post('/database/projects/add',isLoggedIn,function(req,res){
		req.body.project.owner = req.user[dbConstants.USER_ID_FIELD];
			dbFunctions.addProject(req.body)
			.then(function(){
				req.flash('redirectURL','/projects');
				req.flash('statusCode','200');
				res.redirect('/success');
			}).catch(function(err){
				console.log(err);
				req.flash('error',err);
				res.redirect('/failure');
			});
	});

	/* delete the project, but only if the request is submitted by
	 * the owner of the project */
	app.post('/database/projects/delete',isLoggedIn,function(req,res){
		var query = {}
		query[dbConstants.PROJECT_ID_FIELD] = req.body.project
		dbFunctions.findOne(dbConstants.PROJECT_COLLECTION_ID,query)
		.then(function(result){
			if (result.owner == req.user[dbConstants.USER_ID_FIELD]){
				dbFunctions.removeProject(req.body.project).then(function(result){
					req.flash('redirectURL','/projects');
					req.flash('statusCode','200');
					res.redirect('/success')
				}).catch(function(err){
					req.flash('error',err);
					res.redirect('/failure')
				})
			} else {
				req.flash('error','Sorry, for security reasons only the original owner of the project may delete it');
				res.redirect('/failure')
			}
		})
	})


	app.post('/database/project/update',isLoggedIn,function(req,res){
		var query = {}
		query[dbConstants.PROJECT_ID_FIELD] = req.body.project
		dbFunctions.findOne(dbConstants.PROJECT_COLLECTION_ID,query)
		.then(function(result){
			if (result.owner == req.user[dbConstants.USER_ID_FIELD]){
				dbFunctions.update(dbConstants.PROJECT_COLLECTION_ID,query,{$set:req.body.update})
				.then(function(result){
					req.flash('redirectURL','/projects');
					req.flash('statusCode','200');
					res.redirect('/success');
				}).catch(function(err){
					req.flash('error',err);
					res.redirect('/failure');
				})
			} else {
				req.flash('error','Sorry, for security reasons only the original owner of the project may delete it');
				res.redirect('/failure')
			}
		});
	});

	// get the owner of a document
	app.post('/database/owner',isLoggedIn,function(req,res){
		var user = req.user[dbConstants.USER_ID_FIELD];
		var collection = req.body.collection;
		var query = req.body.query;
		dbFunctions.getOwner(collection,query)
		.then(function(result){
			if (result);
				var _o = {
					owner:result,
					isOwner:(user==result),
					user:user
				}
				res.send(_o);
		}).catch(function(err){
			console.log(err);
		});
	});

	/* checkt to see whether the content within the body is within the database
	 *  returns true/false */
	app.post('/database/checkInDatabase',isLoggedIn,function(req,res){
		var options = req.body;
		if (options.collection == dbConstants.PATIENT_COLLECTION_ID && options.field == dbConstants.PATIENT_ID_FIELD){
			for (var i=queue.queue.length-1; i>= 0; i--){
				for ( var j=0; j < queue.queue[i]['fields'].length; j++){
					if(queue.queue[i]['fields'][dbConstants.PATIENT_ID_FIELD] == options.value){
						res.send(true);
						return true;
					}

				}
			}
		}
		dbFunctions.checkInDatabase(options.collection,options.field,options.value)
		.then(function(result){
			res.send(result);
		});
	});

	//==================================================================
	//PGX routes
	//==================================================================
	app.get("/patients", isLoggedIn, function(req,res){
		var username = req.user['username'];
		dbFunctions.findAllPatients(undefined,true, {sort: {"completed": -1}}, username)
		.then(function(result){
			res.send(result);
		});

	});

	app.post("/patients", isLoggedIn, function(req,res){
		var project,exclude;
		var username = req.user['username'];
		var query = {}
		if (req.body.exclude){
			query = {}
			exclude = req.body.project
		} else {
			query[dbConstants.PROJECT_ARRAY_FIELD] = req.body['project'];
			project = req.body.project
		}

		dbFunctions.findAllPatients(query,true, {sort: {"completed": -1}}, username,project,exclude)
		.then(function(result){
			res.send(result);
		});
	});

	app.post("/pgx", isLoggedIn, function(req,res){
		var currentPatientID= req.body["patient_id"];
		dbFunctions.getPGXVariants(currentPatientID)
		.then(function(result) {
			// Return all PGx information: variants from this patient along
			// with all PGx haplotype and marker data. Also return the patient
			// ID to ensure we're returning the correct patient (in case 
			// multiple clicks are happening and there's a delay in the response).
			var allPGXDetails= {
				"pgxGenes": pgx.pgxGenes,
				"pgxCoordinates": pgx.pgxCoordinates,
				"patientID": currentPatientID,
				"variants": result["variants"],
				"report-footer": result["report-footer"],
				"disclaimer": result["disclaimer"]
			};

			return Promise.resolve(allPGXDetails);
		}).then(function(result){
			res.send(result);
		});
	})

	//==================================================================
	//UPLOADER
	//==================================================================
	/* jquery-file-upload-middlware routs
	 * The jquery file upload middleware handles the bulf ot the work when it comes to the file
	 * Upload. The jquery-file-upload plugin emits an ajax call and then the middleware handles 
	 * the response. It has automatic event handlers for listeing to cancellations (aka aborts)
	 * and failures. In these scenarios it will automatically delete the incomplete file.
	 * additionally it also has handlers for file success and file download
	*/


	//Configure the uploader to tell it what directories to use
	uploader.configure({
		tmpDir:nodeConstant.TMP_UPLOAD_DIR,
		uploadDir:nodeConstant.VCF_UPLOAD_DIR,
		uploadUrl:'/upload/vcf'
	});
	/* Event Handler that is triggered upon successful completion of the file upload
	 * This handler facilitates the addition of annotation information adn the inclusion
	 * of the vcf file into the local database
	*/
	uploader.on('end',function(fileInfo,req,res){
		queue.addToQueue(fileInfo,req.fields,req.user[dbConstants.USER_ID_FIELD])
		.then(function(){
			if (!queue.isRunning)
				return queue.run();
		}).catch(function(err){console.log(err.toString())});
	})

	app.use("/upload/vcf", isLoggedIn, uploader.fileHandler());



	//==================================================================
	//DEPRECATED GA4G REQUESTS
	//==================================================================
	app.get("/datasets", isLoggedIn, function(req,res){
		render(req,res);
	});

	app.use("/callsets/search", isLoggedIn, function(req,res){
		render(req,res);
	});

	app.use("/variants/search", isLoggedIn, function(req,res){
		render(req,res);
	});


	//==================================================================
	//Handle 404 routes
	//==================================================================
	/* NOTE: This must always be the ABSOLUTE last route added,
	 * Otherwise It will redirect a legitimate route to the 404 page.
	 * Essentially its sayin, anything coming in will be sent to 404notfound
	 */
	app.get('*', function(req,res){
		render(req,res);
	})
}




function isLoggedIn(req,res,next){
	if (req.isAuthenticated())
		return next();
	res.redirect('/login');
}