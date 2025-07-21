import * as THREE from 'three';
import { Coordinates } from '@itowns/geographic';
import DEMUtils from 'Utils/DEMUtils';
import { XRControllerModelFactory } from 'ThreeExtended/webxr/XRControllerModelFactory';

/**
 * @property {Array} controllers - WebXR controllers list
 * */
class VRControls {
    static MIN_DELTA_ALTITUDE = 0;
    static MAX_NUMBER_CONTROLLERS = 2;  // For now, we are fully supporting a maximum of 2 controllers.
    /**
     * Requires a contextXR variable.
     * @param {*} _view itowns view object
     * @param {*} _groupXR XR 3D object group
     * @param {boolean} cameraOnGround camera movment always on the ground
     */
    constructor(_view, _groupXR = {}, cameraOnGround = false) {
    // Store instance references.
        this.view = _view;
        this.groupXR = _groupXR;
        this.webXRManager = _view.mainLoop.gfxEngine.renderer.xr;
        this.cameraOnGround = cameraOnGround;

        this.lines = [];

        this.rightButtonPressed = false;
        this.controllers = [];
        this.initControllers();
    }

    // Static factory method:
    static init(view, vrHeadSet) {
        return new VRControls(view, vrHeadSet);
    }


    initControllers() {
        //  Add a light for the controllers
        this.groupXR.add(new THREE.HemisphereLight(0xa5a5a5, 0x898989, 3));

        const controllerModelFactory = new XRControllerModelFactory();

        // Add line to controller
        const geometry = new THREE.BufferGeometry();
        geometry.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -5)]);


        for (let i = 0; i < VRControls.MAX_NUMBER_CONTROLLERS; i++) {
            const controller = this.webXRManager.getController(i);
            const line = new THREE.Line(geometry);
            controller.add(line);
            this.lines.push(line);

            controller.addEventListener('connected', (event) => {
                controller.name = event.data.handedness;    // Left or right
                controller.userData.handedness = event.data.handedness;
                controller.gamepad = event.data.gamepad;
                this.groupXR.add(controller);

                const gripController = this.webXRManager.getControllerGrip(i);
                gripController.name = `${controller.name}GripController`;
                gripController.userData.handedness = event.data.handedness;
                this.bindGripController(controllerModelFactory, gripController, this.groupXR);
                this.controllers.push(controller);
                this.groupXR.add(gripController);


                // Event listeners
                this.setupEventListeners(controller);
            });

            // this.addColorCube();

            controller.addEventListener('disconnected', function removeCtrl() {
                this.remove(this.children[0]);
            });
        }
    }


    /**
     * Debug
     */
    addColorCube() {
        // --- Create button mesh ---
        function makeButtonMesh(x, y, z, c, opacity, wireframe) {
            const geometry = new THREE.BoxGeometry(x, y, z);
            const material = new THREE.MeshBasicMaterial({ color: c });
            material.wireframe = wireframe;
            material.transparent = true;
            material.opacity = opacity;
            const buttonMesh = new THREE.Mesh(geometry, material);
            buttonMesh.name = 'button';

            return buttonMesh;
        }

        const groupSelectColor = new THREE.Group();

        const red = makeButtonMesh(0.1, 0.1, 0.1, 0x008000, 1, false);
        red.position.set(-0.2, 0, 0);
        const green = makeButtonMesh(0.1, 0.1, 0.1, 0xFF0000, 1, false);
        green.position.set(0, 0, 0);
        const blue = makeButtonMesh(0.1, 0.1, 0.1, 0x0000FF, 1, false);
        blue.position.set(0.2, 0, 0);

        groupSelectColor.add(red);
        groupSelectColor.add(green);
        groupSelectColor.add(blue);

        groupSelectColor.position.set(0, 0.2, -0.5);
        groupSelectColor.name = 'selector';

        this.webXRManager.getController(1).add(groupSelectColor);
    }

    bindGripController(controllerModelFactory, gripController, vrHeadSet) {
        gripController.add(controllerModelFactory.createControllerModel(gripController));
        vrHeadSet.add(gripController);
    }




    // Register event listeners for controllers.
    setupEventListeners(controller) {
        controller.addEventListener('itowns-xr-axes-changed', e => this.onAxisChanged(e));
        controller.addEventListener('itowns-xr-axes-stop', e => this.onAxisStop(e));
        controller.addEventListener('itowns-xr-button-pressed', e => this.onButtonPressed(e));
        controller.addEventListener('itowns-xr-button-released', e => this.onButtonReleased(e));

        controller.addEventListener('selectstart', e => this.onSelectStart(e));
        controller.addEventListener('selectend', e => this.onSelectEnd(e));
    }


    /*
Listening {XRInputSource} and emit changes for convenience user binding,
There is NO JOYSTICK Events so we need to check it ourselves
Adding a few internal states for reactivity
- controller.isStickActive {boolean} true when a controller stick is not on initial state.
*/

    listenGamepad() {
        for (const controller of this.controllers) {
            if (!controller.gamepad) {
                return;
            }
            // gamepad.axes = [0, 0, x, y];

            const gamepad = controller.gamepad;
            const activeValue = gamepad.axes.some(value => value !== 0);

            // Handle stick activity state
            if (controller.isStickActive && !activeValue && controller.gamepad.endGamePadtrackEmit) {
                controller.dispatchEvent({
                    type: 'itowns-xr-axes-stop',
                    message: { controller },
                });
                controller.isStickActive = false;
                return;
            } else if (!controller.isStickActive && activeValue) {
                controller.gamepad.endGamePadtrackEmit = false;
                controller.isStickActive = true;
            } else if (controller.isStickActive && !activeValue) {
                controller.gamepad.endGamePadtrackEmit = true;
            }

            if (activeValue) {
                controller.dispatchEvent({
                    type: 'itowns-xr-axes-changed',
                    message: { controller },
                });
            }

            for (const [index, button] of gamepad.buttons.entries()) {
                if (button.pressed) {
                    // 0 - trigger
                    // 1 - grip
                    // 3 - stick pressed
                    // 4 - bottom button
                    // 5 - upper button
                    controller.dispatchEvent({
                        type: 'itowns-xr-button-pressed',
                        message: {
                            controller,
                            buttonIndex: index,
                            button,
                        },
                    });
                    controller.lastButtonItem = button;
                } else if (controller.lastButtonItem && controller.lastButtonItem === button) {
                    controller.dispatchEvent({
                        type: 'itowns-xr-button-released',
                        message: {
                            controller,
                            buttonIndex: index,
                            button,
                        },
                    });
                    controller.lastButtonItem = undefined;
                }

                if (button.touched) {
                    // triggered really often
                }
            }
        }
    }


    // Clamp a translation to ground and then apply the transformation.
    clampAndApplyTransformationToXR(trans, offsetRotation) {
        const transClamped = this.clampToGround(trans);
        this.applyTransformationToXR(transClamped, offsetRotation);
    }

    // Apply a translation and rotation to the XR group.
    applyTransformationToXR(trans, offsetRotation) {
        this.groupXR.position.copy(trans);
        this.groupXR.quaternion.copy(offsetRotation);
        this.groupXR.updateMatrixWorld(true);
    }

    /**
   * Clamp the given translation vector so that the camera remains at or above ground level.
   * @param {THREE.Vector3} trans - The translation vector.
   * @returns {THREE.Vector3} The clamped coordinates as a Vector3.
   */
    clampToGround(trans) {
        const transCoordinate = new Coordinates(
            this.view.referenceCrs,
            trans.x,
            trans.y,
            trans.z,
        );

        const terrainElevation = DEMUtils.getElevationValueAt(
            this.view.tileLayer,
            transCoordinate,
            DEMUtils.PRECISE_READ_Z,
        ) || 0;

        if (this.view.controls.getCameraCoordinate) {
            const coordsProjected = transCoordinate.as(this.view.controls.getCameraCoordinate().crs);
            if (coordsProjected.altitude - terrainElevation - VRControls.MIN_DELTA_ALTITUDE <= 0) {
                coordsProjected.altitude = terrainElevation + VRControls.MIN_DELTA_ALTITUDE;
            }
            if (this.cameraOnGround) {
                coordsProjected.altitude = terrainElevation + VRControls.MIN_DELTA_ALTITUDE;
            }
            return coordsProjected.as(this.view.referenceCrs).toVector3();
        } else {
            return trans;
        }
    }

    // Calculate a speed factor based on the camera's altitude.
    getSpeedFactor() {
        // eslint-disable-next-line no-unused-vars
        const altitude = this.view.controls.getCameraCoordinate ? this.view.controls.getCameraCoordinate().altitude : 1;
        return 0.2; // TODO: Adjust if needed -> add as a config ?
    }

    // Calculate a yaw rotation quaternion based on an axis value from the joystick.
    getRotationYaw(axisValue) {
        // Clone the current XR group's orientation.
        const baseOrientation = this.groupXR.quaternion.clone().normalize();
        let deltaRotation = 0;

        if (axisValue) {
            deltaRotation = -Math.PI * axisValue / 140; // Adjust sensitivity as needed.
        }
        // Get the "up" direction from the camera coordinate. // TODO should we handle other than globe ?
        const upAxis = this.groupXR.position.clone().normalize();
        // Create a quaternion representing a yaw rotation about the up axis.
        const yawQuaternion = new THREE.Quaternion()
            .setFromAxisAngle(upAxis, deltaRotation)
            .normalize();
        // Apply the yaw rotation.
        baseOrientation.premultiply(yawQuaternion);
        return baseOrientation;
    }

    // Calculate a pitch rotation quaternion based on an axis value from the joystick.
    getRotationPitch(axisValue) {
    // Clone the current XR group's orientation.
        const baseOrientation = this.groupXR.quaternion.clone().normalize();
        let deltaRotation = 0;

        if (axisValue) {
            deltaRotation = -Math.PI * axisValue / 140; // Adjust sensitivity as needed.
        }

        // Compute the right axis from the current orientation.
        // (Assuming (1, 0, 0) is the right direction in local space.)
        const rightAxis = new THREE.Vector3(1, 0, 0)
            .applyQuaternion(baseOrientation)
            .normalize();

        // Create a quaternion representing a pitch rotation about the right axis.
        const pitchQuaternion = new THREE.Quaternion()
            .setFromAxisAngle(rightAxis, deltaRotation)
            .normalize();

        // Apply the pitch rotation.
        baseOrientation.premultiply(pitchQuaternion);
        return baseOrientation;
    }

    // Compute a translation vector for vertical adjustment.
    getTranslationElevation(axisValue, speedFactor) {
        const speed = axisValue * speedFactor;
        const direction = this.view.camera3D.position.clone().normalize();

        direction.multiplyScalar(-speed);
        return direction;
    }

    // Handles camera flying based on controller input.
    cameraOnFly(ctrl) {
        let directionX = new THREE.Vector3();
        let directionZ = new THREE.Vector3();
        const speedFactor = this.getSpeedFactor();
        if (ctrl.gamepad.axes[3] !== 0) {
            const speed = ctrl.gamepad.axes[3] * speedFactor;
            directionZ = new THREE.Vector3(0, 0, 1)
                .applyQuaternion(this.view.camera3D.quaternion.clone().normalize())
                .multiplyScalar(speed);
        }
        if (ctrl.gamepad.axes[2] !== 0) {
            const speed = ctrl.gamepad.axes[2] * speedFactor;
            directionX = new THREE.Vector3(1, 0, 0)
                .applyQuaternion(this.view.camera3D.quaternion.clone().normalize())
                .multiplyScalar(speed);
        }
        const offsetRotation = this.groupXR.quaternion.clone();
        const trans = this.groupXR.position.clone().add(directionX.add(directionZ));
        // this.applyTransformationToXR(trans, offsetRotation);
        this.clampAndApplyTransformationToXR(trans, offsetRotation);
    }

    /* =======================
     Event Handler Methods
     ======================= */

    // Right select ends.
    /* c8 ignore next 3 */
    onSelectRightEnd() {
    // Uncomment and implement teleportation if needed:
    }

    // Right select starts.
    /* c8 ignore next 3 */
    onSelectRightStart() {
    // No operation needed yet.
    }

    // Left select starts.
    /* c8 ignore next 3 */
    onSelectLeftStart() {
    // No operation needed yet.
    }

    // Left select ends.
    /* c8 ignore next 3 */
    onSelectLeftEnd() {
        // No operation needed yet.
    }
    onSelectStart(data) {
        const ctrl = data.target;

        if (ctrl.userData.handedness === 'left') {
            this.onSelectLeftStart(ctrl);
        } else if (ctrl.userData.handedness === 'right') {
            this.onSelectRightStart(ctrl);
        }
    }
    onSelectEnd(data) {
        const ctrl = data.target;

        if (ctrl.userData.handedness === 'left') {
            this.onSelectRightEnd(ctrl);
        } else if (ctrl.userData.handedness === 'right') {
            this.onSelectLeftEnd(ctrl);
        }
    }
    onButtonPressed(data) {
        const ctrl = data.target;
        if (ctrl.userData.handedness === 'left') {
            this.onLeftButtonPressed(data);
        } else if (ctrl.userData.handedness === 'right') {
            this.onRightButtonPressed(data);
        }
    }

    // Right button pressed.
    onRightButtonPressed(data) {
        const sunPos = this.view.simulateSun();

        const geometrySun = new THREE.SphereGeometry(15, 32, 16); 
        const materialSun = new THREE.MeshBasicMaterial({ color: 0xffff00 }); 
        const sun = new THREE.Mesh(geometrySun, materialSun);
        sun.position.set(sunPos.x, sunPos.y, sunPos.z);
        sun.updateMatrixWorld();
        this.view.scene.add(sun);

        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 5000)]);

        const material = new THREE.LineBasicMaterial({ color: 0xffff00 }); // yellow line
        const line = new THREE.Line(geometry, material);

        line.position.set(this.view.camera.camera3D.position.x, this.view.camera.camera3D.position.y, this.view.camera.camera3D.position.z);
        line.lookAt(sunPos);
        line.updateMatrixWorld();

        this.view.scene.add(line);
    }


    // ---- Debug tool ----

    /**
     * Recursively searches for the first feature in a THREE.Object3D.
     * @param {THREE.Object3D} obj
     * @returns {Object|undefined}
    */
    findFeatureInChildren(obj) {
        if (!obj) { return undefined; }
        if (obj.feature) { return [obj, obj.feature]; }
        for (const child of (obj.children || [])) {
            const found = this.findFeatureInChildren(child);
            if (found) { return found; }
        }
        return undefined;
    }

    /**
     * Returns the boolean is the cleabs is in the feature list.
     * @param {Object} feature
     * @param {string} cleabs
     * @returns {boolean}
    */
    findDateCreationByCleabs(feature, cleabs) {
        if (!feature || !feature.geometries) { return false; }
        for (const geom of feature.geometries) {
            if (geom.properties.cleabs === cleabs) {
                return true;
            }
        }
        return false;
    }


    // Left button pressed.
    /* c8 ignore next 3 */
    onLeftButtonPressed() {
        // get mesh correspond to cleabs
        // let dateCreation;
        // // For debugging: search for the creation date of a specific cleabs in all child meshes
        // const cleabsTarget = 'BATIMENT0000000336960181';
        // const layer = this.view.getLayers().find(l => l.id === 'WFS Building');
        // let meshWithCleabs;
        // for (const child of layer.object3d.children) {
        //     const obj = this.findFeatureInChildren(child);
        //     dateCreation = this.findDateCreationByCleabs(obj[1], cleabsTarget);
        //     if (dateCreation) {
        //         meshWithCleabs = obj[0];
        //         break;
        //     }
        // }

        // const raycaster = new THREE.Raycaster();
        // const pos = new THREE.Vector3();
        // const dir = new THREE.Vector3();

        // // right line
        // this.lines[1].getWorldPosition(pos);
        // this.lines[1].getWorldDirection(dir);

        // raycaster.ray.origin = pos;
        // raycaster.ray.direction = dir.multiplyScalar(-1);

        // // calculate objects intersecting the picking ray
        // const intersects = raycaster.intersectObjects(this.view.scene.children);
        // if (intersects.length > 0 && intersects[0].object.name == 'button') {
        //     const buttonGrip = intersects[0].object;
        //     if (meshWithCleabs) {
        //         meshWithCleabs.material = buttonGrip.material;
        //         this.view.notifyChange();
        //     }
        // }

        function findMeshinChildren(featureMesh) {
            const children = featureMesh.children[0];
            if (children.isMesh) {
                // children.material.transparent = true;
                // children.material.opacity = 0.1;

                const material = new THREE.MeshBasicMaterial({ color: children.material.color });
                material.transparent = true;
                material.opacity = 0.5;
                children.material = material;
            } else {
                findMeshinChildren(children);
            }
        }

        this.view.renderer.setClearColor(new THREE.Color(), 0);
        this.view.tileLayer.opacity = 0;

        // Add the event listener only once when the layer is ready
        const layer = this.view.getLayers().find(l => l.id === 'WFS Building');
        if (layer) {
            layer.whenReady.then(() => {
                layer.object3d.children.forEach((featureMesh) => {
                    findMeshinChildren(featureMesh);
                    this.view.notifyChange();
                });
            });
        }


        this.view.notifyChange();
    }

    // Axis changed.
    onAxisChanged(data) {
        const ctrl = data.target;
        if (ctrl.gamepad.axes[2] === 0 && ctrl.gamepad.axes[3] === 0) {
            return;
        }
        if (ctrl.userData.handedness === 'left') {
            this.onLeftAxisChanged(ctrl);
        } else if (ctrl.userData.handedness === 'right') {
            this.onRightAxisChanged(ctrl);
        }
    }

    // Right axis changed.
    onRightAxisChanged(ctrl) {
        if (ctrl.userData.handedness !== 'right') {
            return;
        }
        //  Check if GRIP is pressed
        if (this.rightButtonPressed) {
            const offsetRotation = this.groupXR.quaternion.clone();
            const speedFactor = this.getSpeedFactor();
            const deltaTransl = this.getTranslationElevation(ctrl.gamepad.axes[3], speedFactor);
            const trans = this.groupXR.position.clone().add(deltaTransl);
            this.clampAndApplyTransformationToXR(trans, offsetRotation);
        } else {
            this.cameraOnFly(ctrl);
        }
    }

    // Left axis changed.
    onLeftAxisChanged(ctrl) {
        if (ctrl.userData.handedness !== 'left') {
            return;
        }

        const trans = this.groupXR.position.clone();
        let offsetRotation;

        //  Only apply rotation on 1 axis at the time
        if (Math.abs(ctrl.gamepad.axes[2]) > Math.abs(ctrl.gamepad.axes[3])) {
            offsetRotation = this.getRotationYaw(ctrl.gamepad.axes[2]);
            this.applyTransformationToXR(trans, offsetRotation); // Yaw rotation only
        } else {
            offsetRotation = this.getRotationPitch(ctrl.gamepad.axes[3]);
        }
    }

    // Right axis stops.
    onAxisStop(data) {
        const ctrl = data.target;

        if (ctrl.userData.handedness === 'left') {
            this.onLeftAxisStop(ctrl);
        } else if (ctrl.userData.handedness === 'right') {
            this.onRightAxisStop(ctrl);
        }
    }

    // Right axis stops.
    /* c8 ignore next 3 */
    onRightAxisStop() {
        // No operation defined.
    }

    // Left axis stops.
    /* c8 ignore next 3 */
    onLeftAxisStop() {
        // No operation defined.
    }

    // Button released.
    onButtonReleased(data) {
        const ctrl = data.target;

        if (ctrl.userData.handedness === 'left') {
            this.onLeftButtonReleased(ctrl);
        } else if (ctrl.userData.handedness === 'right') {
            this.onRightButtonReleased(ctrl);
        }
    }
    // Right button released.
    onRightButtonReleased() {
        this.rightButtonPressed = false;
    }

    // Left button released.
    /* c8 ignore next 3 */
    onLeftButtonReleased() {
    // No operation defined.
    }
}

export default VRControls;
