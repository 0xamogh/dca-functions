import * as admin from "firebase-admin";
admin.initializeApp();

import { exportFunctions } from "better-firebase-functions";
exportFunctions({ __filename, exports });
