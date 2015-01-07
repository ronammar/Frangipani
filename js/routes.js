/*
 * Defines the routes for the Server.
 * @author Ron Ammar
 */

var express= require("express");
var ga4ghRequests= require("./ga4gh-requests");
var bodyParser= require("body-parser");


var getRouter= express.Router();
getRouter.use(function(request, response) {
	var promise;

	if (request.baseUrl == "/datasets") {
		promise= ga4ghRequests.getProjects();
	}

	promise.then(function(result) {
		// Currently, I'm not paying attention to the next page token because
		// it doesn't always appear. If it ever does, write an error to console
		// so that it is brought to my attention.
		if (result.nextPageToken !== undefined) {
			console.log("ERROR: nextPageToken found, not managed.");
		}

		response.send(result);
	}, function(err) {
		console.log(err);
	});
});

var postRouter= express.Router();
postRouter.use(bodyParser.json());
postRouter.use(function(request, response) {
	var promise;

	if (request.baseUrl == "/callsets/search") {
		promise= ga4ghRequests.getPatients(request.body);
	} else if (request.baseUrl == "/variants/search") {
		promise = ga4ghRequests.getVariants(request.body);
	}
	promise.then(function(result) {
		response.send(result);
	}, function(err) {
		console.log(err);
	});
});


/*var variantRouter = express.Router();
variantRouter.use(bodyParser.json());
variantRouter.use(function(request,response){
	var promise;

	if (request.baseUrl == "/variants/search") {
		promise = ga4ghRequests.getVariants(request.body);
	}

	promise.then(function(result){
		response.send(result);
	}, function(err){
		console.log(err);
	});
});
*/
exports.getRouter= getRouter;
exports.postRouter= postRouter;
//exports.variantRouter = variantRouter;


