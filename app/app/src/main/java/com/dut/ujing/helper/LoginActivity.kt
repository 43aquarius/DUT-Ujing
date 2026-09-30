package com.dut.ujing.helper

import android.os.Bundle
import android.os.CountDownTimer
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.dut.ujing.helper.databinding.ActivityLoginBinding
import com.dut.ujing.helper.ujing.Store
import com.dut.ujing.helper.ujing.UjingApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.regex.Pattern

/** 登录页：手机号 + 短信验证码（与 Web 版同一套接口） */
class LoginActivity : AppCompatActivity() {

    private lateinit var b: ActivityLoginBinding
    private var countdown: CountDownTimer? = null
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(b.root)

        b.btnSend.setOnClickListener { sendCaptcha() }
        b.btnLogin.setOnClickListener { doLogin() }
    }

    override fun onDestroy() {
        countdown?.cancel()
        super.onDestroy()
    }

    private fun err(msg: String?) {
        if (msg.isNullOrBlank()) {
            b.tvError.visibility = View.GONE
        } else {
            b.tvError.text = msg
            b.tvError.visibility = View.VISIBLE
        }
    }

    private fun sendCaptcha() {
        val mobile = b.etPhone.text.toString().trim()
        if (!Pattern.compile("^1\\d{10}$").matcher(mobile).matches()) {
            err("请输入正确的 11 位手机号")
            return
        }
        if (busy) return
        busy = true
        b.btnSend.isEnabled = false
        b.progress.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { UjingApi.sendCaptcha(mobile) }
                err(null)
                toast("验证码已发送，请注意查收短信")
                startCountdown()
            } catch (e: Exception) {
                busy = false
                b.btnSend.isEnabled = true
                err(e.message ?: "验证码发送失败，请稍后重试")
            } finally {
                b.progress.visibility = View.GONE
            }
        }
    }

    private fun startCountdown() {
        countdown?.cancel()
        countdown = object : CountDownTimer(60_000, 1_000) {
            override fun onTick(ms: Long) {
                b.btnSend.text = "${ms / 1000}s"
            }

            override fun onFinish() {
                b.btnSend.text = getText(R.string.btn_send_captcha)
                b.btnSend.isEnabled = true
                busy = false
            }
        }.start()
    }

    private fun doLogin() {
        val mobile = b.etPhone.text.toString().trim()
        val captcha = b.etCaptcha.text.toString().trim()
        if (!Pattern.compile("^1\\d{10}$").matcher(mobile).matches()) {
            err("请输入正确的 11 位手机号"); return
        }
        if (captcha.length < 4) {
            err("请输入短信验证码"); return
        }
        if (busy) return
        busy = true
        err(null)
        b.btnLogin.isEnabled = false
        b.progress.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val token = withContext(Dispatchers.IO) { UjingApi.login(mobile, captcha) }
                Store.saveSession(this@LoginActivity, mobile, token)
                MainActivity.start(this@LoginActivity, clearStack = true)
                finishAffinity()
            } catch (e: Exception) {
                busy = false
                b.btnLogin.isEnabled = true
                err(e.message ?: "登录失败，请稍后重试")
            } finally {
                b.progress.visibility = View.GONE
            }
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
