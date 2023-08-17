import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms'; 
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import {MatSidenavModule} from '@angular/material/sidenav';
import {MatSnackBarModule} from '@angular/material/snack-bar';
import {MatDialogModule} from '@angular/material/dialog';
import {MatTooltipModule} from '@angular/material/tooltip';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatTableModule} from '@angular/material/table';

import { NavBoardComponent } from './nav-board/nav-board.component';
import { StartScreenComponent } from './start-screen/start-screen.component';
import { LobbyComponent } from './lobby/lobby.component';
import { SnackbarComponent } from './snackbar/snackbar.component';
import { CreateRunComponent } from './dialogs/create-run/create-run.component';
import { SetPathComponent } from './dialogs/set-path/set-path.component';
import { RunComponent } from './run/run.component';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';
import { environment } from '../environments/environment';
import { RunSplitsComponent } from './run-splits/run-splits.component';
import { RunTimerComponent } from './run-timer/run-timer.component';
import { RunSpectatorsComponent } from './run-spectators/run-spectators.component';
import { CloseScreenComponent } from './close-screen/close-screen.component';
import { LobbyViewerComponent } from './lobby-viewer/lobby-viewer.component';
import { ConfirmComponent } from './dialogs/confirm/confirm.component';
import { InfoComponent } from './dialogs/info/info.component';
import { NewUpdateComponent } from './dialogs/new-update/new-update.component';
import { InputDialogComponent } from './dialogs/input-dialog/input-dialog.component';
import { HeaderComponent } from './header/header.component';
import { RunHistoryComponent } from './run-history/run-history.component';

@NgModule({
  declarations: [
    AppComponent,
    NavBoardComponent,
    StartScreenComponent,
    LobbyComponent,
    SnackbarComponent,
    CreateRunComponent,
    SetPathComponent,
    RunComponent,
    RunSplitsComponent,
    RunTimerComponent,
    RunSpectatorsComponent,
    CloseScreenComponent,
    LobbyViewerComponent,
    ConfirmComponent,
    InfoComponent,
    NewUpdateComponent,
    InputDialogComponent,
    HeaderComponent,
    RunHistoryComponent
  ],
  imports: [
    BrowserModule,
    FormsModule,
    AppRoutingModule,
    BrowserAnimationsModule,
    MatSidenavModule,
    MatSnackBarModule,
    MatDialogModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatTableModule,
    AngularFireModule.initializeApp(environment.firebase),
    AngularFirestoreModule,
    AngularFireAuthModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
