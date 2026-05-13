package com.bali.student.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.bali.student.data.auth.AmplifyAuth
import com.bali.student.ui.screens.ClassDetailScreen
import com.bali.student.ui.screens.ClassesScreen
import com.bali.student.ui.screens.LoginScreen
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

object Routes {
    const val LOGIN = "login"
    const val CLASSES = "classes"
    const val CLASS_DETAIL = "class/{classId}"
    fun classDetail(classId: String) = "class/$classId"
}

@HiltViewModel
class StartupViewModel @Inject constructor(
    private val auth: AmplifyAuth,
) : ViewModel() {
    private val _start = MutableStateFlow<String?>(null)
    val start: StateFlow<String?> = _start

    init {
        viewModelScope.launch {
            _start.value = if (auth.isSignedIn()) Routes.CLASSES else Routes.LOGIN
        }
    }
}

@Composable
fun BaliNavHost(vm: StartupViewModel = hiltViewModel()) {
    val navController = rememberNavController()
    val start by vm.start.collectAsState()
    val resolved = start ?: return

    NavHost(navController = navController, startDestination = resolved) {
        composable(Routes.LOGIN) {
            LoginScreen(
                onSignedIn = {
                    navController.navigate(Routes.CLASSES) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                },
            )
        }
        composable(Routes.CLASSES) {
            ClassesScreen(
                onOpenClass = { id -> navController.navigate(Routes.classDetail(id)) },
                onSignedOut = {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(Routes.CLASSES) { inclusive = true }
                    }
                },
            )
        }
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
    }
}
