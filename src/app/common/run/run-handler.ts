import { Run } from "./run";
import { RunMode } from "./run-mode";
import { LocalPlayerData } from "../user/local-player-data";
import { Lobby } from "../firestore/lobby";
import { RTCPeerMaster } from "../peer/rtc-peer-master";
import { RTCPeerSlave } from "../peer/rtc-peer-slave";
import { AngularFirestore, AngularFirestoreDocument } from "@angular/fire/compat/firestore";
import { UserService } from "src/app/services/user.service";
import { Subscription } from "rxjs";
import { DataChannelEvent } from "../peer/data-channel-event";
import { EventType } from "../peer/event-type";
import { PlayerState } from "../player/player-state";
import { RunState } from "./run-state";
import { CollectionName } from "../firestore/collection-name";
import { NgZone } from "@angular/core";
import { Timer } from "./timer";
import { Task } from "../opengoal/task";
import { OG } from "../opengoal/og";
import { Team } from "./team";

export class RunHandler {
    
    lobby: Lobby | undefined;
    run: Run | undefined;

    loaded: boolean = false;

    localMaster: RTCPeerMaster | undefined;
    localSlave: RTCPeerSlave | undefined;

    lobbyDoc: AngularFirestoreDocument<Lobby>;
    runDoc: AngularFirestoreDocument<Run>;
    userService: UserService;
    private localPlayer: LocalPlayerData;
    private obsUserId: string | null;

    zone: NgZone;
    dataSubscription: Subscription;
    lobbySubscription: Subscription;

    constructor(lobbyId: string, firestore: AngularFirestore, userService: UserService, localUser: LocalPlayerData, zone: NgZone, obsUserId: string | null = null) {
        this.lobbyDoc = firestore.collection<Lobby>(CollectionName.lobbies).doc(lobbyId);
        this.runDoc = firestore.collection<Run>(CollectionName.runs).doc();
        this.userService = userService;
        this.localPlayer = localUser;
        this.zone = zone;
        this.obsUserId = obsUserId;

        //when loaded listen on lobby
        this.lobbySubscription = this.lobbyDoc.snapshotChanges().subscribe(snapshot => {
            if (snapshot.payload.metadata.hasPendingWrites) return;
            let lobby = snapshot.payload.data();
            if (!lobby) return;
            this.lobby = lobby;

            //create run if it doesn't exist
            if (!this.run) {
                console.log("Creating Run!");
                this.run = new Run(this.lobby.runData);


                //setup local user (this should be done here or at some point that isn't instant to give time to load in the user if a dev refresh happens while on run page)
                this.localPlayer.name = this.userService.getName();
                this.localPlayer.mode = this.run.data.mode;
                let playerTeam = this.run.getPlayerTeam(obsUserId ? obsUserId : this.localPlayer.name);
                if (playerTeam) 
                    this.localPlayer.team = playerTeam;
                else
                    this.checkCleanSelfRemains();
            }

            this.onLobbyChange();
        });

    }


    checkCleanSelfRemains() {
        const userId = this.userService.getName();
        if (this.lobby?.runners.includes(userId)) {
            this.lobby.runners = this.lobby.runners.filter(x => x !== userId);
            if (!this.lobby.spectators.includes(userId))
                this.lobby.spectators.push(userId);
            this.updateFirestoreLobby();
        }
    }


    async onLobbyChange() {
        const userId = this.userService.getName();
        if (!this.lobby) return;

        console.log("Got Lobby Change!");
        //become master if needed (for example host disconnect or no host at start)
        if ((!this.lobby.host || (this.lobby.host === userId && !this.localMaster)) && (!this.lobby.backupHost || this.lobby.backupHost === userId) && !this.localPlayer.isObs()) {
            console.log("Becomming host!");
            //cleanup own slave connection if previously slave (in for example host disconnect)
            if (this.localSlave) {
                await this.lobbyDoc.collection("peerConnection").doc(userId).delete();
                this.localSlave.destory();
                this.dataSubscription.unsubscribe();
                this.localSlave = undefined;
            }

            this.lobby.host = userId;
            
            if (this.lobby.backupHost === userId) //host is kicked out of user list and lobby host role by backupHost on data channel disconnect
                this.lobby.backupHost = this.lobby.runners.find(user => user !== userId) ?? null;
            
            this.updateFirestoreLobby();
            this.setupMaster(userId);
            this.loaded = true;
        }

        //become slave if master exists
        if (!this.localMaster && !this.localSlave)
            this.setupSlave(userId);

        //master checks if lobby has changed
        if(this.localMaster) {
            //check for backupHost disconnect
            if (!this.lobby.backupHost)
                this.lobby.backupHost = this.lobby.runners.find(user => user !== userId) ?? null;

            //check for new users/peer connections
            this.localMaster.onLobbyChange(this.lobby);
        }
    }


    setupMaster(userId: string) {
        console.log("Setting up master!");
        this.localMaster = new RTCPeerMaster(userId, this.lobbyDoc);
        this.dataSubscription = this.localMaster.eventChannel.subscribe(event => {
            this.onDataChannelEvent(event, true);
        });
    }

    setupSlave(userId: string) {
        console.log("Setting up slave!");
        this.localSlave = new RTCPeerSlave(userId, this.lobbyDoc);
        this.dataSubscription = this.localSlave.eventChannel.subscribe(event => {
            this.onDataChannelEvent(event, false);
        });
    }

    updateFirestoreLobby() {
        this.lobby!.lastUpdateDate = new Date().toUTCString();
        this.lobbyDoc.set(JSON.parse(JSON.stringify(this.lobby)));
    }

    getPlayerState(): void {
        if ((window as any).electron)
            (window as any).electron.send('og-state-read');
    }

    sendEvent(type: EventType, value: any = null) {
        const event = new DataChannelEvent(this.userService.getName(), type, value);
        if (this.localSlave) {
            this.localSlave.peer.sendEvent(event);
            this.onDataChannelEvent(event, false); //to run on a potentially safer but slower mode disable this and send back the event from master/host
        }
        else if (this.localMaster)
            this.onDataChannelEvent(event, true);
    }



    onDataChannelEvent(event: DataChannelEvent, isMaster: boolean) {
        const userId = this.userService.getName();

        //send updates to master to all slaves | this should be here and not moved up to sendEvent as it's not the only method triggering this
        if (isMaster && event.type !== EventType.Connect && event.type !== EventType.Disconnect && event.type !== EventType.RequestRunSync && event.type !== EventType.RunSync)
            this.localMaster?.relayToSlaves(event);

        switch (event.type) {

            case EventType.Connect: //rtc stuff on connection is setup individually in rtc-peer-master/slave
                console.log(event.user + " connected!");
                if (!isMaster) {
                    console.log("Sending run request!");
                    this.sendEvent(EventType.RequestRunSync);
                }
                break;


            case EventType.Disconnect:
                if(!this.lobby) return;

                if (isMaster) {
                    let peer = this.localMaster!.peers.find(x => x.userId === event.user);
                    peer?.peer.destory();
                    if (peer)
                        this.localMaster!.peers = this.localMaster!.peers.filter(x => x.userId !== event.user)

                    this.lobby.runners = this.lobby.runners.filter(user => user !== event.user);
                    this.lobby.spectators = this.lobby.spectators.filter(user => user !== event.user);

                    //host on backupHost disconnect
                    if (event.user === this.lobby.backupHost)
                        this.lobby.backupHost = null; //will be set by host onLobbyChange

                    this.updateFirestoreLobby();
                }
                //backupHost on master disconnect
                else if (event.user === this.lobby.host && this.lobby.backupHost === userId) {
                    this.lobby.host = null; //current user will pickup host role on the file change
                    this.updateFirestoreLobby();
                }
                break;


            case EventType.RequestRunSync:
                if (isMaster)
                    console.log("Got run request, responding!");
                    this.localMaster?.respondToSlave(new DataChannelEvent(userId, EventType.RunSync, this.run), event.user);
                break;
            

            case EventType.RunSync:
                this.zone.run(() => { 
                    console.log("Got run from request!", event.value);

                    //update run
                    let run: Run = JSON.parse(JSON.stringify(event.value)); //to not cause referece so that import can run properly on the run after
                    this.run = Object.assign(new Run(run.data), run).reconstructRun();
                    
                    //update player and team
                    this.localPlayer.mode = this.run.data.mode;
                    let playerTeam = this.run?.getPlayerTeam(this.obsUserId ? this.obsUserId : this.localPlayer.name);
                    if (playerTeam) {
                        //clean out collectables so that potentially missed ones are given on import
                        if (!this.obsUserId)
                            playerTeam.tasks = [];
                        this.localPlayer.team = playerTeam;
                    }
                    
                    //update lobby
                    if (!this.obsUserId && this.lobby) {
                        let updateDb = false;
                        if (this.lobby.spectators.includes(userId)) {
                            this.lobby.spectators = this.lobby.spectators.filter(x => x !== userId);
                            updateDb = true;
                        }
                        if (!this.lobby.runners.includes(userId)) {
                            this.lobby.runners.push(userId);
                            updateDb = true;
                        }
                        if (updateDb)
                            this.updateFirestoreLobby();
                    }

                    this.run!.importChanges(this.localPlayer, event.value);
                    this.loaded = true;
                });
                break;



            case EventType.EndPlayerRun:  
                this.zone.run(() => { 
                    this.run?.endPlayerRun(event.user);

                    if (this.run?.timer.runState === RunState.Ended)
                        this.runDoc.set(JSON.parse(JSON.stringify(this.run)));
                });
                break;


            case EventType.NewCell: 
                if (!this.run) return;
                this.zone.run(() => { 
                    this.run!.addSplit(event.value);
                });

                //handle none current user things
                if (event.user !== userId) {
                    this.run.giveCellToUser(event.value, this.run.getPlayer(userId));
                    
                    if (this.run.getPlayerTeam(event.user)?.name === this.localPlayer.team?.name) {
                        //handle klaww kill
                        if ((event.value as Task).gameTask === "ogre-boss") {
                            this.localPlayer.killKlawwOnSpot = true;
                            this.localPlayer.checkKillKlaww();
                        }
                        else //check if orb buy
                            this.localPlayer.checkForFirstOrbCellFromMultiSeller((event.value as Task).gameTask);
                    }
                }

                //handle SCR
                if (this.run.data.mode === RunMode.SCR) {
                    const playerTeam = this.run.getPlayerTeam(this.localPlayer.name);
                    if (!playerTeam) break;
                    if (this.run.teams.some(team => team.name !== playerTeam.name && team.cellCount > playerTeam.cellCount))
                        OG.removeFinalBossAccess(this.localPlayer.gameState.currentLevel);
                    else
                        OG.giveFinalBossAccess(this.localPlayer.gameState.currentLevel);
                }
                break;


            case EventType.NewPlayerState: 
                if (!this.run) return;
                this.zone.run(() => { 
                    this.run!.updateState(event.user, event.value);
                });
                
                const player = this.run.getPlayer(userId);
                if (player) {
                    this.run.onUserStateChange(this.localPlayer, player);
                    if (event.user !== userId)
                        this.localPlayer.checkForZoomerTalkSkip(event.value);
                } 
                break;


            case EventType.NewTaskStatusUpdate:
                if (!this.run || this.run.getPlayerTeam(event.user)?.name !== this.localPlayer.team?.name) return;
                this.localPlayer.updateTaskStatus(new Map(Object.entries(event.value)), event.user === userId);
                break;

                
            case EventType.ChangeTeam:
                this.zone.run(() => { 
                    this.run?.changeTeam(event.user, event.value, this.localPlayer.name === event.user ? this.userService.user.twitchName : null);

                    if (this.obsUserId && this.obsUserId === event.user) { //set otherwise from run component if normal user
                        this.localPlayer.team = this.run?.getPlayerTeam(this.obsUserId);
                    }
                });
                break;


            case EventType.Ready:
                this.zone.run(() => { 
                    this.run!.toggleReady(event.user, event.value); 
                });  
                
                //check if everyone is ready, send start call if so
                if (isMaster && event.value === PlayerState.Ready && this.run!.everyoneIsReady()) {
                this.lobby!.visible = false;
                this.updateFirestoreLobby();
                
                this.sendEvent(EventType.StartRun, new Date().toUTCString());
                }     
                break;
            

            case EventType.StartRun:
                this.zone.run(() => { 
                    this.run!.start(new Date());
                    this.run!.setOrbCosts(this.localPlayer.name);
                    this.getPlayerState();
                });  
                //!TODO: could be done in some more elegant way
                setTimeout(() => {
                    this.localPlayer.resetRunDependentProperties();
                }, this.run!.timer.countdownSeconds * 1000)
                break;
            

            case EventType.CheckRemoveRunner:
                if(this.run?.timer.runState === RunState.Waiting) {
                    this.zone.run(() => { 
                        this.run?.removePlayer(event.user);
                    });  
                }
                break;


            case EventType.ToggleReset:
                this.zone.run(() => { 
                    if (this.run!.toggleVoteReset(event.user, event.value)) {
                        OG.runCommand("(send-event *target* 'loading)");
                        this.localPlayer.state = PlayerState.Neutral;
                    }
                });  
                break;


            default:
                console.log("MISSING EVENT TYPE IMPLEMENTATION!");
        }
    }


    destroy() {
        this.sendEvent(EventType.CheckRemoveRunner);

        const wasHost = this.localMaster && this.lobby?.host === this.localPlayer.name;

        this.localMaster?.destroy();
        this.localSlave?.destory();

        this.dataSubscription?.unsubscribe();
        this.lobbySubscription?.unsubscribe();

        if (this.lobby && (wasHost || this.lobby?.host === null)) { //host removes user from lobby otherwise but host has to the job for himself
            if (wasHost) {
                console.log("Removing host!")
                this.lobby.host = null;
            }
            this.lobby.runners = this.lobby.runners.filter(user => user !== this.localPlayer.name);
            this.lobby.spectators = this.lobby.spectators.filter(user => user !== this.localPlayer.name);
            this.updateFirestoreLobby();
        }
    }
}