package com.bali.student.ui.nav

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.bali.student.data.auth.AmplifyAuth
import com.bali.student.data.prefs.StudentPrefs
import com.bali.student.ui.screens.ClassDetailScreen
import com.bali.student.ui.screens.ClassesScreen
import com.bali.student.ui.screens.FocusModeScreen
import com.bali.student.ui.screens.JoinConfirmScreen
import com.bali.student.ui.screens.JoinScreen
import com.bali.student.ui.screens.LoginScreen
import com.bali.student.ui.screens.ProfileScreen
import com.bali.student.ui.screens.SettingsScreen
import com.bali.student.ui.screens.SetupScreen
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

object Routes {
    const val LOGIN = "login"
    const val SETUP = "setup"
    const val CLASSES = "classes"
    const val JOIN = "join"
    const val PROFILE = "profile"
    const val SETTINGS = "settings"
    const val CLASS_DETAIL = "class/{classId}"
    const val FOCUS_MODE = "focus"
    const val JOIN_CONFIRM = "join/confirm/{classId}"
    fun classDetail(classId: String) = "class/$classId"
    fun joinConfirm(classId: String) = "join/confirm/$classId"
}

private data class BottomTab(val route: String, val label: String, val icon: ImageVector)

private val BottomTabs = listOf(
    BottomTab(Routes.CLASSES, "Classes", Icons.Outlined.School),
    BottomTab(Routes.JOIN, "Join", Icons.Outlined.AddCircleOutline),
    BottomTab(Routes.PROFILE, "Profile", Icons.Outlined.Person),
    BottomTab(Routes.SETTINGS, "Settings", Icons.Outlined.Settings),
)

private val BottomTabRoutes = BottomTabs.map { it.route }.toSet()

@HiltViewModel
class StartupViewModel @Inject constructor(
    private val auth: AmplifyAuth,
    private val prefs: StudentPrefs,
) : ViewModel() {
    private val _start = MutableStateFlow<String?>(null)
    val start: StateFlow<String?> = _start

    init {
        viewModelScope.launch {
            _start.value = when {
                !auth.isSignedIn() -> Routes.LOGIN
                !prefs.isSetupComplete() -> Routes.SETUP
                else -> Routes.CLASSES
            }
        }
    }
}

@Composable
fun BaliNavHost(vm: StartupViewModel = hiltViewModel()) {
    val navController = rememberNavController()
    val start by vm.start.collectAsState()
    val resolved = start ?: return

    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showBottomBar = currentRoute in BottomTabRoutes

    Scaffold(
        containerColor = Color.Transparent,
        bottomBar = {
            if (showBottomBar) {
                BaliBottomBar(currentRoute, onTabSelected = { route -> navigateToTab(navController, route) })
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = resolved,
            modifier = Modifier.padding(padding),
        ) {
            authGraph(navController)
            tabGraph(navController)
            detailGraph(navController)
        }
    }
}

private fun NavGraphBuilder.authGraph(navController: NavHostController) {
    composable(Routes.LOGIN) {
        LoginScreen(
            onSignedIn = {
                navController.navigate(Routes.SETUP) {
                    popUpTo(Routes.LOGIN) { inclusive = true }
                }
            },
        )
    }
    composable(Routes.SETUP) {
        SetupScreen(
            onContinue = {
                navController.navigate(Routes.CLASSES) {
                    popUpTo(Routes.SETUP) { inclusive = true }
                }
            },
        )
    }
}

private fun NavGraphBuilder.tabGraph(navController: NavHostController) {
    val toLogin: () -> Unit = {
        navController.navigate(Routes.LOGIN) {
            popUpTo(0) { inclusive = true }
        }
    }
    composable(Routes.CLASSES) { entry ->
        val refreshSignal by entry.savedStateHandle
            .getStateFlow("refresh", false)
            .collectAsState()
        ClassesScreen(
            onOpenClass = { id -> navController.navigate(Routes.classDetail(id)) },
            onOpenJoin = { navigateToTab(navController, Routes.JOIN) },
            refreshSignal = refreshSignal,
            onRefreshSignalHandled = { entry.savedStateHandle["refresh"] = false },
        )
    }
    composable(Routes.JOIN) {
        JoinScreen(
            onConfirm = { id -> navController.navigate(Routes.joinConfirm(id)) },
        )
    }
    composable(Routes.PROFILE) {
        ProfileScreen()
    }
    composable(Routes.SETTINGS) {
        SettingsScreen(onSignedOut = toLogin)
    }
}

private fun NavGraphBuilder.detailGraph(navController: NavHostController) {
    composable(
        route = Routes.CLASS_DETAIL,
        arguments = listOf(navArgument("classId") { type = NavType.StringType }),
    ) { backStack ->
        val id = backStack.arguments?.getString("classId").orEmpty()
        ClassDetailScreen(
            classId = id,
            onBack = { navController.popBackStack() },
        )
    }
    composable(Routes.FOCUS_MODE) {
        FocusModeScreen(onBack = { navController.popBackStack() })
    }
    composable(
        route = Routes.JOIN_CONFIRM,
        arguments = listOf(navArgument("classId") { type = NavType.StringType }),
    ) {
        JoinConfirmScreen(
            onCancel = { navController.popBackStack() },
            onJoined = {
                runCatching {
                    navController.getBackStackEntry(Routes.CLASSES)
                        .savedStateHandle["refresh"] = true
                }
                navController.popBackStack(Routes.CLASSES, false)
            },
            onViewClass = { id ->
                navController.navigate(Routes.classDetail(id)) {
                    popUpTo(Routes.JOIN_CONFIRM) { inclusive = true }
                }
            },
        )
    }
}

private fun navigateToTab(navController: NavHostController, route: String) {
    navController.navigate(route) {
        popUpTo(Routes.CLASSES) {
            saveState = true
            inclusive = false
        }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun BaliBottomBar(currentRoute: String?, onTabSelected: (String) -> Unit) {
    NavigationBar {
        BottomTabs.forEach { tab ->
            NavigationBarItem(
                selected = currentRoute == tab.route,
                onClick = { onTabSelected(tab.route) },
                icon = { Icon(tab.icon, contentDescription = tab.label) },
                label = { Text(tab.label) },
                colors = NavigationBarItemDefaults.colors(),
            )
        }
    }
}
