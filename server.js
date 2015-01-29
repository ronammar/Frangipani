/*
 * Frangipani genome annotation server that connects to genome storage servers
 * via the GA4GH API.
 * @author Ron Ammar
 */

var express= require("express");
dbFunctions= require("./frangipani_node_modules/mongodb_functions");
var uploader= require("jquery-file-upload-middleware");
var routes= require("./frangipani_node_modules/routes");
var Promise= require("bluebird");
var dbConstants= require("./frangipani_node_modules/mongodb_constants");
var fs = Promise.promisifyAll(require('fs'));


/* Command line options */
var opts= require("nomnom")
	.option("portNumber", {
		abbr: "p",
		full: "port",
		default: 8080,
		help: "User-specifed port number"
	})
	.option("mongodbHost", {
		full: "mongodb-host",
		default: dbConstants.DB_HOST,
		help: "User-specifed MongoDB hostname",
		callback: function(mongodbHost) {
			dbConstants.DB_HOST= mongodbHost;
		}
	})
	.option("mongodbPortNumber", {
		full: "mongodb-port",
		default: dbConstants.DB_PORT,
		help: "User-specifed MongoDB port number",
		callback: function(mongodbPortNumber) {
			dbConstants.DB_PORT= parseInt(mongodbPortNumber);
		}
	})
	.parse();
console.log("Server running on port " + opts.portNumber);


/* Initialize the server. */
var app= express();
var configured= undefined;


/* Connect to the DB. */
dbFunctions.connectAndInitializeDB()
	.catch(function(err) {
		console.error(err.toString());
		console.error(err.stack);
		console.log("Exiting due to connection error with DB server.");
		process.exit(1);
	});


/* Check if /upload and /tmp directories exist. If not, creates them. */
var prerequisiteDirectories= ["upload", "tmp"];
for (var i= 0; i < prerequisiteDirectories.length; ++i) {
	// using an immediately-invoked function expression to keep scope across iterations
	(function () {
		var currentDirectory= prerequisiteDirectories[i];
		fs.statAsync(currentDirectory).then(function(result){
			// directory already exists
		}).catch(function(err){
			console.log(currentDirectory + ' directory does not exist. Created.');
			return fs.mkdirAsync(currentDirectory);
		}).catch(function(err){
			console.log("Cannot create " + currentDirectory + " folder");
			console.log(err);
		});
	})();
}


/* Serve static content (css files, js files, templates, etc) from the
 * foundation directory. */
app.use(express.static("foundation-5.4.6", {index: false}));

app.get("/", function(request, response) {
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
			response.sendFile("foundation-5.4.6/frangipani.html", {root: "."});
			if (!configured) {
				configured= resolved_config;
			}
		} else {
			response.sendFile("foundation-5.4.6/config.html", {root: "."});
		}
	});
});

app.use("/datasets", routes.getRouter);
app.use("/callsets/search", routes.postRouter);
app.use("/variants/search",routes.postRouter);
app.use("/upload/vcf",routes.uploadRouter);
app.use("/database/getPatients", routes.getPatients);
app.use("/config", routes.postRouter);
app.use("/patients", routes.getRouter);

app.listen(opts.portNumber);
/* Listen for SIGINT events. These can be generated by typing CTRL + C in the 
 * terminal. */ 
process.on("SIGINT", function(){
	console.log("\nReceived interrupt signal. Closing connections to DB...");
	dbFunctions.closeConnection(function() {
		console.log("Bye!");
		process.exit(0);
	});
});