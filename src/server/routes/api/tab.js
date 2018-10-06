/**
 * Created by PranavJain on 2/20/17.
 */
let express = require('express');
let router = express.Router();

let passport = require('../../lib/auth');
let helpers = require('../../lib/helpers');
let redis = require('../../lib/redis').redis;
let redisIsConnected = require('../../lib/redis').redisIsConnected;
let request = require("request-promise-native");
let serverOptions = require('../../lib/remoteServer');
// using redis, create, edit and delete tabs
/*
{
    status: 'success',
        data: {
                            "uid": element.uid,
                            "pin": element.pin || "NULL",
                            "name": element.firstname + ' ' + element.lastname,
                            "shirtSize": element.shirt_size,
                            "diet": element.dietary_restriction || "NULL",
                            "counter": 0,
                            "numScans": 0

                        },
    message: 'Incremented Tab.'
}
*/
//todo: move queues to redis
//TODO: Switch to maps
let unsent_scans = [];
let unsent_assignments = [];



//authorization functions
//all functions with "requireAuth" used to have helpers.ensureAuthenticated


//DOC: scan rfid and setup info
//rename Tab localhost:3000/tabs/setup/ with rfid tag
//btw we know pin exists
/* REQUEST
{
    id: <<RFID CODE>>,
    pin: <<base 10 pin>>
}
 */
/* RESPONSE
{
    status: 'success',
    data: "OK",
    message: 'Created tab.'
}
 */
/**
 * @api {get} /tabs/setup Register RFID Band to User
 * @apiVersion 1.0.0
 * @apiName Register RFID Band to User
 * @apiGroup RFID
 * @apiPermission TeamMemberPermission
 *
 * @apiParam {Number} id=Math.inf Limit to a certain number of responses
 * @apiParam {Number} offset=0 The offset to start retrieving users from. Useful for pagination
 *
 * @apiUse AuthArgumentRequired
 *
 * @apiSuccess {Array} Array of registered hackers
 */
router.post('/setup', helpers.ensureScannerAuthenticated, function (req, res, next) {
  if(!req.body.id || !req.body.pin){
    console.error("Invalid values passed for rfid or pin");
    return res.status(401).send(new Error("Invalid values passed for rfid or pin"));
  }
  let userRFID = req.body.id;
  //we know pin exists
  let pin = parseInt(req.body.pin, 10);

  console.log("OPENING TAB WITH USER: " + userRFID);
  console.log("WE HAVE PIN: " + pin);
  if(!redisIsConnected()){
      return res.status(500)
          .json({
              status: 'error',
              message: 'Redis database is down'
          });
  }
  redis.hgetall(userRFID, function (err, obj) {
    if (err) {
      return res.status(500)
        .json({
          status: 'error',
          message: 'Something went wrong'
        });
    } else {
        console.log(obj);
      if (obj) {
        return res.status(409)
          .json({
            status: 'error',
            data: obj,
            message: 'RFID Tag already opened.'
          });
      } else {
        redis.rename(pin, userRFID, function (err, reply) {
          // returns error if couldn't find pin...
          if (err) {
            console.log("ERR Could not find pin: " + err);
            res.status(404).json({
              status: "error",
              data: err,
              message: "Invalid pin"
            });
          } else {
            console.log("Successfully set rfid to tab!");
            res.status(200)
              .json({
                status: 'success',
                data: reply,
                message: 'Created tab.'
              });
            //send rfid change to server asynchronously
            //get user
            redis.hgetall(userRFID, function (err, obj) {
              if (err) {
                console.log(err);
              } else {
                console.dir(obj);

                //prep request to send asynch
                let options = helpers.clone(serverOptions);
                options.method = 'POST';
                options.uri = options.uri + '/v1/scanner/assignment';
                let scan = {
                  "rfid": userRFID,
                  "uid": obj.uid,
                  "time": Date.now()
                };
                //TODO: check if this won't have race condition with unsent_assignments being reset
                unsent_assignments.push(scan);
                options.body = {
                  assignments: unsent_assignments
                };
                console.dir(unsent_assignments);
                /*
                  200 if everything is success
                  207 if partial failure
                    - ones that succeeded will have the original scan
                    - ones that failed, it will contain an error with a status code
                    (409 = DUPLICATE or invalid relation) (500 for other issues)
                  400 if formatting of sent info is bad
                  409 if Duplicate
                  500 if everything failed
                 */
                request(options).then(function (response) {
                  console.dir("SUCCESS: " + JSON.stringify(response));
                  let newUnsent_assign = [];
                  if(response.statusCode === 207){
                    response.forEach(function (item) {
                      if(item instanceof Error){
                        if(item.status >= 500){
                          //bad response from server, retry scan

                          newUnsent_assign.push(item.body.scan);
                        }else if(item.status >= 400){
                          //bad request, drop from list
                          console.error(item.body.message);
                        }
                      }
                    });
                  }
                  unsent_assignments = newUnsent_assign;

                }).catch(function (err) {
                  // Something bad happened, handle the error 400 and 500 errors
                  console.log(err.message);
                  //TODO: if duplicate entry, delete that entry otherwise everything will always fail.
                  //don't delete unsent_assignments...
                  if(err.statusCode >= 500){
                    //bad response from server, retry scan
                  }else{
                    //bad request, drop from list
                    unsent_assignments = [];
                  }
                });
              }
            });


          }
        });
      }
    }
  });


});


//DOC: check if pin exists
/* REQUEST
{
    pin: <<base 14 pin>>
}
 */
/*RESPONSE
{
    status: 'success',
    data: {
        "uid": element.uid,
        "pin": element.pin || "NULL",
        "name": element.firstname + ' ' + element.lastname,
        "shirtSize": element.shirt_size,
        "diet": element.dietary_restriction || "NULL",
        "counter": 0,
        "numScans": 0
    },
    message: 'Some Message.'
}
*/
router.post('/getpin', helpers.ensureScannerAuthenticated, function (req, res, next) {
  if(!req.body.pin){
    console.error("Invalid values passed for pin");
    return res.status(401).send(new Error("Invalid values passed for pin"));
  }
  let pin = parseInt(req.body.pin, 10);
  console.log("PIN IS: " + pin);
    if(!redisIsConnected()){
        return res.status(500)
            .json({
                status: 'error',
                message: 'Redis database is down'
            });
    }
  redis.hgetall(pin, function (err, obj) {
    if (err) {
      res.status(404)
        .json({
          status: 'error',
          message: 'Does not exist or already set.'
        });
    } else {
      console.dir(obj);
      if (obj) {
        res.status(200)
          .json({
            status: 'success',
            data: obj,
            message: 'Found.'
          });
      } else {
        res.status(404)
          .json({
            status: 'error',
            data: obj,
            message: 'Did not find anything.'
          });
      }
    }
  });
});


//DOC: increment counter to tab of rfid: https://redis.io/commands/hincrby
//Does food count and regular workshops
/* REQUEST
{
    location: <<Identifier for which physical location the scanner is in>>,
    id: <<RFID TAG>>
}
 */
/*RESPONSE
{
    status: 'success',
    data: {
        "uid": element.uid,
        "pin": element.pin || "NULL",
        "name": element.firstname + ' ' + element.lastname,
        "shirtSize": element.shirt_size,
        "diet": element.dietary_restriction || "NULL",
        "counter": 0,
        "numScans": 0,
        "isRepeat": false/true
    },
    message: 'Incremented Tab.'
}
*/
router.post('/add', helpers.ensureScannerAuthenticated, function (req, res, next) {
  //let store = new Store({
  //    'name': req.body.name,
  //    'description': req.body.description,
  //});
  if(!req.body.location || !req.body.id){
    console.error("Invalid values passed for location or id");
    return res.status(401).send(new Error("Invalid values passed for location or id"));
  }

  let location = req.body.location;
  let userRFID = req.body.id;

  //console.log("Scanned RFID: " + userRFID + "\n with pi ID: " + location);

  //setup sending to server asynchronously
  let scan = {
    "rfid_uid": userRFID.toString(),
    "scan_location": location.toString(),
    "scan_time": Date.now()
  };
    let options = helpers.clone(serverOptions);
    let uri = options.uri;
    options.uri = uri + '/v1/scanner/scans';
    options.method = 'POST';
  if(!redisIsConnected()){
      return res.status(500)
          .json({
              status: 'error',
              message: 'Redis database is down'
          });
  }
  //They haven't registered and it'll still go through but make a seperate location for this.
  //need to throw an error that doesn't exist
  //redis.hget(tabKey, "numProducts", function (err, reply) {
  //add to redis
  redis.exists(userRFID, function (err, val) {
    if (err) {

    } else {
      if (val == 0) {
        res.status(401)
          .json({
            status: 'error',
            data: val,
            message: 'Does not exist.'
          });
      } else {
        if (location == process.env.FOOD) {
          redis.HINCRBY(userRFID, "counter", 1, function (err, obj) {
            if (err) {
              res.status(500)
                .json({
                  status: 'error',
                  message: 'Something went wrong'
                });
            } else {

              //actually send to server now that we know it exists
              //todo:worry about promises and mutli data usage
                unsent_scans.push(scan);
                options.body = {
                    scans: unsent_scans
                };
                console.log("UNSENT SCANS: " + JSON.stringify(options.body));
              /*
                200 if everything is success
                207 if partial failure
                  - ones that succeeded will have the original scan
                  - ones that failed, it will contain an error with a status code
                  (409 = DUPLICATE or invalid relation) (500 for other issues)
                400 if formatting of sent info is bad
                409 if Duplicate
                500 if everything failed
               */
              request(options).then(function (response) {
                console.dir("SUCCESS: " + JSON.stringify(response));
                let newUnsent_scans = [];
                if(response.statusCode === 207){
                  response.forEach(function (item) {
                    if(item instanceof Error){
                      if(item.status >= 500){
                        //bad response from server, retry scan

                        newUnsent_scans.push(item.body.scan);
                      }else if(item.status >= 400){
                        //bad request, drop from list
                        console.error(item.body.message);
                      }
                    }
                  });
                }
                unsent_scans = newUnsent_scans;

              }).catch(function (err) {
                // Something bad happened, handle the error 400 and 500 errors
                console.log(err.message);
                //TODO: if duplicate entry, delete that entry otherwise everything will always fail.
                //don't delete unsent_assignments...
                if(err.statusCode >= 500){
                  //bad response from server, retry scan
                }else{
                  //bad request, drop from list
                  unsent_scans = [];
                }
              });

              console.log("Incrementing FOOD counter");
              if (obj) {
                redis.hgetall(userRFID, function (err, user) {
                  if (err) {
                    res.status(500)
                      .json({
                        status: 'error',
                        message: 'Something went wrong'
                      });
                  } else {
                      let retVal = {
                          uid: user.uid,
                          pin: user.pin,
                          name: user.name,
                          shirtSize: user.shirtSize,
                          diet: user.diet,
                          counter: user.counter,
                          numScans: user.numScans,
                          isRepeat: false
                      };
                    if (retVal.counter > 1) {
                        retVal.isRepeat = true;
                    }
                    console.dir(retVal);
                    res.status(200)
                      .json({
                        status: 'success',
                        data: retVal,
                        message: 'Incremented Tab.'
                      });
                  }

                });
              } else {
                res.status(417)
                  .json({
                    status: 'error',
                    data: obj,
                    message: 'Couldn\'t find rfid'
                  });
              }
            }
          });
        } else {
          redis.HINCRBY(userRFID, "numScans", 1, function (err, obj) {
            if (err) {
              res.status(500)
                .json({
                  status: 'error',
                  message: 'Something went wrong'
                });
            } else {
              //actually send to server now that we know it exists
                unsent_scans.push(scan);
                options.body = {
                    scans: unsent_scans
                };
                console.log("UNSENT SCANS: " + JSON.stringify(options.body));
              //todo:worry about promises and mutli data usage
              /*
                200 if everything is success
                207 if partial failure
                  - ones that succeeded will have the original scan
                  - ones that failed, it will contain an error with a status code
                  (409 = DUPLICATE or invalid relation) (500 for other issues)
                400 if formatting of sent info is bad
                409 if Duplicate
                500 if everything failed
               */
              request(options).then(function (response) {
                console.dir("SUCCESS: " + JSON.stringify(response));
                let newUnsent_scans = [];
                if(response.statusCode === 207){
                  response.forEach(function (item) {
                    if(item instanceof Error){
                      if(item.status >= 500){
                        //bad response from server, retry scan

                        newUnsent_scans.push(item.body.scan);
                      }else if(item.status >= 400){
                        //bad request, drop from list
                        console.error(item.body.message);
                      }
                    }
                  });
                }
                unsent_scans = newUnsent_scans;

              }).catch(function (err) {
                // Something bad happened, handle the error 400 and 500 errors
                console.log(err.message);
                //TODO: if duplicate entry, delete that entry otherwise everything will always fail.
                //don't delete unsent_assignments...
                if(err.statusCode >= 500){
                  //bad response from server, retry scan
                }else{
                  //bad request, drop from list
                  unsent_scans = [];
                }
              });

              console.log("Incrementing numScans counter");
              if (obj) {

                let numScans = parseInt(obj.toString()) - 1;
                let scanLocKey = "Scan." + numScans + ".location";
                let scanTimeKey = "Scan." + numScans + ".time";
                let data = {};
                let date = scan.scan_time;
                data[scanLocKey] = location;
                data[scanTimeKey] = date;
                redis.hmset(userRFID, data, function (err, reply) {
                  // reply is null when the key is missing
                  if (err) {
                    return next(err);
                  } else {
                    console.log("Successfully added to tab!");
                    redis.hgetall(userRFID, function (err, user) {
                      if (user) {
                          let retVal = {
                              uid: user.uid,
                              pin: user.pin,
                              name: user.name,
                              shirtSize: user.shirtSize,
                              diet: user.diet,
                              counter: user.counter,
                              numScans: user.numScans,
                              isRepeat: false
                          };
                          console.dir(retVal);
                        res.status(200)
                          .json({
                            status: 'success',
                            data: retVal,
                            message: 'Incremented Tab.'
                          });
                      } else {
                        res.status(200)
                          .json({
                            status: 'success',
                            data: reply,
                            message: 'Incremented Tab.'
                          });
                      }
                    });

                  }
                });

              } else {
                res.status(500)
                  .json({
                    status: 'error',
                    message: 'Something went wrong'
                  });
              }
            }
          });
        }
      }
    }
  });


});

//DOC: Get user information from RFID tag
/* REQUEST
{
    id: <<RFID CODE>>
}
 */
/* RESPONSE
{
    status: 'success',
    data: {
        "uid": element.uid,
        "pin": element.pin || "NULL",
        "name": element.firstname + ' ' + element.lastname,
        "shirtSize": element.shirt_size,
        "diet": element.dietary_restriction || "NULL",
        "counter": 0,
        "numScans": 0
    },
    message: 'Retrieved tab.'
}
 */

router.get('/user-info', helpers.ensureScannerAuthenticated, function (req, res, next) {
  if(!req.query.id){
    console.error("Invalid values passed for rfid");
    return res.status(401).send(new Error("Invalid values passed for rfid"));
  }
  let userRFID = req.query.id;
  if(!redisIsConnected()){
      return res.status(500)
          .json({
              status: 'error',
              message: 'Redis database is down'
          });
  }
  redis.hgetall(userRFID, function (err, obj) {
    if (err) {
      res.status(500)
        .json({
          status: 'error',
          data: err,
          message: 'Does not exist or already set.'
        });
    } else {
      console.dir(obj);
      if (obj) {
        res.status(200)
          .json({
            status: 'success',
            data: obj,
            message: 'Found.'
          });
      } else {
        res.status(401)
          .json({
            status: 'error',
            data: obj,
            message: 'Did not find anything.'
          });
      }
    }
  });


});

/**
 * @api {get} /tabs/active-locations Get all active locations
 * @apiVersion 1.0.0
 * @apiName Get all active locations
 * @apiGroup RFID
 * @apiPermission TeamMemberPermission
 *
 *
 * @apiUse AuthArgumentRequired
 *
 * @apiSuccess {Array} Array of currently active locations
 * @apiSuccessExample {json} Success-Response:
 *  HTTP/1.1 200 OK
 *  {
 *    locations: [
      {
        "location_name": "Cybertorium",
        "uid": 2
      },
      {
        "location_name": "Atrium",
        "uid": 5
      },
      {
        "location_name": "Business Building Room 120",
        "uid": 6
      },
      {
        "location_name": "Atrium Staircase",
        "uid": 11
      },
      {
        "location_name": "Game room",
        "uid": 15
      }
    ]
   }
 *
 */
router.get('/active-locations', function (req, res, next) {

  let timestamp = Date.now();

  let options = helpers.clone(serverOptions);
  let uri = options.uri;
  options.uri = uri + '/v1/scanner/location';
  request(options).then(function (response) {
    //empty list of unsent scans
    console.dir("SUCCESS: " + JSON.stringify(response));
    res.status(200).json({
      status: 'success',
      locations: response,
      length: response.length,
      message: 'Found active locations.'
    });
  }).catch(function (err) {
    // Something bad happened, handle the error
    console.log(err);
    res.status(500).json({
      status: 'error',
      data: err,
      message: 'Server error.'
    });
    //do not remove unsent scans
  });


});


let cursor = '0';

function scan(pattern, keys, callback) {

  redis.scan(cursor, 'MATCH', pattern, 'COUNT', '1000', function (err, reply) {
    if (err) {
      throw err;
    }
    cursor = reply[0];
    keys.push.apply(keys, reply[1]);
    if (cursor === '0') {
      return callback(keys);
    } else {

      return scan(pattern, keys, callback);
    }
  });
}


module.exports = router;
